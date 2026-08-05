import * as Tone from 'tone';
import type {
  SynthState,
  OscillatorState,
  LFOState,
  EffectId,
  ModDestination,
} from './types';
import { midiToFrequency, DEFAULT_EFFECT_CHAIN } from './types';

/**
 * Maps resonance 0-1 to BiquadFilter Q value.
 * 0 → Q=0.5 (gentle), 1 → Q=18 (very resonant)
 */
function resonanceToQ(r: number): number {
  return 0.5 + r * 17.5;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

interface Voice {
  oscillators: Tone.Oscillator[];
  /** One panner per oscillator (enables per-osc pan + unison stereo spread). */
  panners: Tone.Panner[];
  gain: Tone.Gain;
  ampEnvelope: Tone.AmplitudeEnvelope;
  noteFrequency: number;
}

type PerVoiceTarget = 'detune' | 'pan';

interface ActiveLfo {
  lfo: Tone.LFO;
  /** When set, the LFO fans out to this param on every live voice. */
  perVoice?: PerVoiceTarget;
}

/**
 * How far an LFO may swing a bipolar target around its base value without
 * leaving [min, max]. Returns the symmetric amplitude (always >= 0).
 */
function bipolarRoom(base: number, min: number, max: number): number {
  return Math.max(0, Math.min(base - min, max - base));
}

/**
 * Core polyphonic synthesizer engine built on Tone.js.
 * Manages oscillators, filter, envelopes, LFOs, and effects.
 *
 * Signal path: osc → per-osc panner → amp envelope → velocity gain
 *            → shared filter → reorderable FX chain → master gain → out.
 *
 * The filter is intentionally *paraphonic* (shared across voices, like the
 * Moog Matriarch's paraphonic mode): the filter envelope retriggers on each
 * note-on and key tracking follows the last played note.
 *
 * Modulation convention: a Tone.Param's `.value` always holds the base value
 * and every connected LFO signal is bipolar around 0, so modulation sums on
 * top of the knob position instead of replacing it. (Tone sums connected
 * signals with the param value.)
 */
export class AudioEngine {
  private masterGain: Tone.Gain;
  private analyserNode: Tone.Waveform;
  private fftAnalyser: Tone.FFT;

  // Filter (shared / paraphonic)
  private filter: Tone.BiquadFilter;
  /** Filter envelope: ADSR (0..1) → filterEnvAmount (Hz, bipolar) → filter.frequency */
  private filterEnv: Tone.Envelope;
  private filterEnvAmount: Tone.Gain;

  // Effects
  private reverb: Tone.Reverb;
  private delay: Tone.FeedbackDelay;
  private chorus: Tone.Chorus;
  private distortion: Tone.Distortion;
  private compressor: Tone.Compressor;
  private eq3: Tone.EQ3;
  private phaser: Tone.Phaser;
  private bitCrusher: Tone.BitCrusher;
  private stereoWidener: Tone.StereoWidener;
  /** Map effect id → its Tone node, for dynamic chain reordering. */
  private effectNodes: Map<EffectId, Tone.ToneAudioNode>;
  /** Current chain order (effect ids only — does not include filter/master). */
  private currentChainOrder: EffectId[] = [...DEFAULT_EFFECT_CHAIN];

  // Legacy direct-route LFOs (lfo1 / lfo2)
  private activeLfos: Map<1 | 2, ActiveLfo> = new Map();
  /** Mod-matrix LFOs keyed by route id. */
  private modLFOs: Map<string, Tone.LFO> = new Map();

  // Polyphony
  private voices: Map<number, Voice> = new Map();
  private maxVoices = 16;

  // Current state reference
  private state: SynthState | null = null;

  // Change-detection keys so applyState() doesn't rebuild modulators
  // (and reset their phase) when unrelated parameters change.
  private lfoKeys: Record<1 | 2, string> = { 1: '', 2: '' };
  private modKey = '';

  // Transport for sequencer
  public transport = Tone.getTransport();

  private started = false;

  constructor() {
    // Master output chain: filter → effects → masterGain → analysers → destination
    this.masterGain = new Tone.Gain(0.75);
    this.analyserNode = new Tone.Waveform(2048);
    this.fftAnalyser = new Tone.FFT(2048);

    this.filter = new Tone.BiquadFilter({
      type: 'lowpass',
      frequency: 5000,
      Q: resonanceToQ(0.2),
    });

    // Paraphonic filter envelope: ADSR 0..1 scaled to a bipolar Hz sweep and
    // summed into filter.frequency (whose value holds the base cutoff).
    this.filterEnv = new Tone.Envelope({
      attack: 0.05,
      decay: 0.4,
      sustain: 0.3,
      release: 0.5,
    });
    this.filterEnvAmount = new Tone.Gain(0);
    this.filterEnv.connect(this.filterEnvAmount);
    this.filterEnvAmount.connect(this.filter.frequency);

    // Effects (all start bypassed)
    this.reverb = new Tone.Reverb({ decay: 2, wet: 0 });
    this.delay = new Tone.FeedbackDelay({ delayTime: 0.375, feedback: 0.4, wet: 0 });
    // Chorus must be started so its internal LFO actually runs
    this.chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.5, wet: 0 }).start();
    this.distortion = new Tone.Distortion({ distortion: 0.3, wet: 0 });
    this.compressor = new Tone.Compressor({
      threshold: 0,
      ratio: 1,
      attack: 0.003,
      release: 0.25,
    });
    this.eq3 = new Tone.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 400, highFrequency: 2500 });
    this.phaser = new Tone.Phaser({
      frequency: 0.5,
      octaves: 3,
      baseFrequency: 350,
      wet: 0,
    });
    // BitCrusher's constructor options type omits `wet` (worklet options),
    // but the Effect base class provides it at runtime.
    this.bitCrusher = new Tone.BitCrusher(8);
    this.bitCrusher.wet.value = 0;
    this.stereoWidener = new Tone.StereoWidener({ width: 0 });

    this.effectNodes = new Map<EffectId, Tone.ToneAudioNode>([
      ['distortion', this.distortion],
      ['bitCrusher', this.bitCrusher],
      ['eq3', this.eq3],
      ['chorus', this.chorus],
      ['phaser', this.phaser],
      ['delay', this.delay],
      ['reverb', this.reverb],
      ['stereoWidener', this.stereoWidener],
      ['compressor', this.compressor],
    ]);

    this.rebuildChain(DEFAULT_EFFECT_CHAIN);
    // Parallel taps off masterGain (not in series) so waveform/fft
    // are independent and either one failing cannot starve the other.
    this.masterGain.connect(this.analyserNode);
    this.masterGain.connect(this.fftAnalyser);
    this.masterGain.toDestination();
  }

  /**
   * Rebuild the post-filter effects chain in the given order.
   * Always: filter → [effects in order] → masterGain → analysers → destination.
   */
  private rebuildChain(order: EffectId[]): void {
    // Validate & dedupe order, append any missing effects in default order
    const seen = new Set<EffectId>();
    const sanitized: EffectId[] = [];
    for (const id of order) {
      if (this.effectNodes.has(id) && !seen.has(id)) {
        sanitized.push(id);
        seen.add(id);
      }
    }
    for (const id of DEFAULT_EFFECT_CHAIN) {
      if (!seen.has(id)) {
        sanitized.push(id);
        seen.add(id);
      }
    }

    // Disconnect everything we control
    this.filter.disconnect();
    for (const node of this.effectNodes.values()) {
      node.disconnect();
    }
    this.masterGain.disconnect();

    // Reconnect in order
    let prev: Tone.ToneAudioNode = this.filter;
    for (const id of sanitized) {
      const node = this.effectNodes.get(id)!;
      prev.connect(node);
      prev = node;
    }
    prev.connect(this.masterGain);
    // Re-attach analyser taps + speakers in parallel.
    this.masterGain.connect(this.analyserNode);
    this.masterGain.connect(this.fftAnalyser);
    this.masterGain.toDestination();

    this.currentChainOrder = sanitized;
  }

  /** Must be called from a user gesture to unlock audio context */
  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  /** Apply full synth state */
  applyState(state: SynthState): void {
    this.state = state;
    this.applyFilter(state);
    this.applyEffects(state);
    this.applyMaster(state);
    this.applyLFOs(state);
    this.applyModulation(state);
  }

  // ===== Filter =====
  private applyFilter(state: SynthState): void {
    const f = state.filter;
    const now = Tone.now();
    this.filter.type = f.type as BiquadFilterType;
    // Smooth ramps avoid zipper noise on knob drags. When the filter is
    // disabled we park it fully open at 20 kHz.
    const base = f.enabled ? f.cutoff : 20000;
    this.filter.frequency.setTargetAtTime(base, now, 0.02);
    this.filter.Q.setTargetAtTime(resonanceToQ(f.resonance), now, 0.02);

    // Filter envelope sweep: bipolar Hz around the base cutoff
    // (envelopeAmount -1..1 → ∓/+ 8 kHz at extremes). Muted when filter off.
    this.filterEnvAmount.gain.value = f.enabled ? f.envelopeAmount * 8000 : 0;
    const fe = state.filterEnvelope;
    this.filterEnv.attack = fe.attack;
    this.filterEnv.decay = fe.decay;
    this.filterEnv.sustain = fe.sustain;
    this.filterEnv.release = fe.release;
  }

  // ===== Effects =====
  private applyEffects(state: SynthState): void {
    const fx = state.effects;

    // Reverb: size 0-1 → decay 0.1-10s; damping 0-1 → preDelay 0-0.1s
    this.reverb.wet.value = fx.reverb.enabled ? fx.reverb.mix : 0;
    const newDecay = Math.max(0.1, 0.1 + fx.reverb.size * 9.9);
    // Tone.Reverb.decay is a number setter — only re-set when changed (it triggers IR regen).
    if (Math.abs((this.reverb.decay as number) - newDecay) > 0.01) {
      this.reverb.decay = newDecay;
    }
    this.reverb.preDelay = fx.reverb.damping * 0.1;

    // Delay
    this.delay.wet.value = fx.delay.enabled ? fx.delay.mix : 0;
    this.delay.delayTime.value = fx.delay.time;
    this.delay.feedback.value = fx.delay.feedback;

    // Chorus
    this.chorus.wet.value = fx.chorus.enabled ? fx.chorus.mix : 0;
    this.chorus.frequency.value = fx.chorus.rate;
    this.chorus.depth = fx.chorus.depth;

    // Distortion
    this.distortion.wet.value = fx.distortion.enabled ? fx.distortion.mix : 0;
    this.distortion.distortion = fx.distortion.drive;

    // Compressor
    this.compressor.threshold.value = fx.compressor.enabled ? fx.compressor.threshold : 0;
    this.compressor.ratio.value = fx.compressor.enabled ? fx.compressor.ratio : 1;
    this.compressor.attack.value = fx.compressor.attack;
    this.compressor.release.value = fx.compressor.release;

    // EQ3 — when disabled, flatten gains (kept in chain so reorder is consistent)
    this.eq3.low.value = fx.eq3.enabled ? fx.eq3.low : 0;
    this.eq3.mid.value = fx.eq3.enabled ? fx.eq3.mid : 0;
    this.eq3.high.value = fx.eq3.enabled ? fx.eq3.high : 0;
    this.eq3.lowFrequency.value = fx.eq3.lowFrequency;
    this.eq3.highFrequency.value = fx.eq3.highFrequency;

    // Phaser
    this.phaser.wet.value = fx.phaser.enabled ? fx.phaser.mix : 0;
    this.phaser.frequency.value = fx.phaser.rate;
    this.phaser.octaves = fx.phaser.octaves;
    this.phaser.baseFrequency = fx.phaser.baseFrequency;

    // BitCrusher
    this.bitCrusher.wet.value = fx.bitCrusher.enabled ? fx.bitCrusher.mix : 0;
    this.bitCrusher.bits.value = fx.bitCrusher.bits;

    // StereoWidener — when disabled, width=0.5 = neutral mono-ish; we use 0.5 baseline
    this.stereoWidener.width.value = fx.stereoWidener.enabled ? fx.stereoWidener.width : 0.5;

    // Chain order
    const order = state.effectChain ?? DEFAULT_EFFECT_CHAIN;
    if (!this.chainOrderEquals(order)) {
      this.rebuildChain(order);
    }
  }

  private chainOrderEquals(order: EffectId[]): boolean {
    if (order.length !== this.currentChainOrder.length) return false;
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== this.currentChainOrder[i]) return false;
    }
    return true;
  }

  // ===== Master =====
  private applyMaster(state: SynthState): void {
    this.masterGain.gain.setTargetAtTime(state.master.volume, Tone.now(), 0.02);
    this.transport.bpm.value = state.master.bpm;
  }

  // ===== LFOs =====
  private applyLFOs(state: SynthState): void {
    this.applyLFO(state.lfo1, 1);
    this.applyLFO(state.lfo2, 2);
  }

  private applyLFO(lfoState: LFOState, index: 1 | 2): void {
    // Target ranges derive from the current cutoff/volume, so those base
    // values participate in the change-detection key.
    const key = JSON.stringify({
      s: lfoState,
      cutoff: this.state?.filter.cutoff,
      filterOn: this.state?.filter.enabled,
      vol: this.state?.master.volume,
    });
    if (this.lfoKeys[index] === key) return; // nothing relevant changed — keep phase
    this.lfoKeys[index] = key;

    this.removeLfo(index);

    if (!lfoState.enabled) return;

    const spec = this.getLFOTarget(lfoState);
    if (!spec) return;

    const lfo = new Tone.LFO({
      frequency: lfoState.rate,
      type: lfoState.waveform,
      min: spec.min,
      max: spec.max,
    });

    if (spec.perVoice) {
      for (const voice of this.voices.values()) {
        this.connectLfoToVoice(lfo, spec.perVoice, voice);
      }
      this.activeLfos.set(index, { lfo, perVoice: spec.perVoice });
    } else if (spec.param) {
      lfo.connect(spec.param);
      this.activeLfos.set(index, { lfo });
    }
    lfo.start();
  }

  private removeLfo(index: 1 | 2): void {
    const existing = this.activeLfos.get(index);
    if (!existing) return;
    const { lfo, perVoice } = existing;
    if (perVoice) {
      for (const voice of this.voices.values()) {
        this.disconnectLfoFromVoice(lfo, perVoice, voice);
      }
    }
    lfo.stop();
    lfo.dispose();
    this.activeLfos.delete(index);
  }

  /**
   * Resolve an LFO target. Connected signals sum with the param's own value,
   * so all ranges here are bipolar around 0 (the base lives in `.value`).
   */
  private getLFOTarget(
    lfoState: LFOState,
  ):
    | { param: Tone.Param<any> | Tone.Signal<any>; min: number; max: number; perVoice?: undefined }
    | { param?: undefined; min: number; max: number; perVoice: PerVoiceTarget }
    | null {
    if (!this.state) return null;
    const depth = lfoState.depth;
    switch (lfoState.target) {
      case 'filterCutoff': {
        const base = this.state.filter.cutoff;
        const amt = depth * bipolarRoom(base, 20, 20000);
        return { param: this.filter.frequency, min: -amt, max: amt };
      }
      case 'volume': {
        const base = this.state.master.volume;
        const amt = depth * bipolarRoom(base, 0, 1);
        return { param: this.masterGain.gain, min: -amt, max: amt };
      }
      case 'pitch':
        // Vibrato: ±depth * 100 cents on every live oscillator's detune.
        return { min: -depth * 100, max: depth * 100, perVoice: 'detune' };
      case 'pan':
        // Auto-pan: ±depth * 0.5 on every live voice panner (panner clamps).
        return { min: -depth * 0.5, max: depth * 0.5, perVoice: 'pan' };
      default:
        return null;
    }
  }

  private connectLfoToVoice(lfo: Tone.LFO, target: PerVoiceTarget, voice: Voice): void {
    if (target === 'detune') {
      for (const osc of voice.oscillators) lfo.connect(osc.detune);
    } else {
      for (const panner of voice.panners) lfo.connect(panner.pan);
    }
  }

  private disconnectLfoFromVoice(lfo: Tone.LFO, target: PerVoiceTarget, voice: Voice): void {
    try {
      if (target === 'detune') {
        for (const osc of voice.oscillators) lfo.disconnect(osc.detune);
      } else {
        for (const panner of voice.panners) lfo.disconnect(panner.pan);
      }
    } catch {
      // Already disconnected / disposed — safe to ignore.
    }
  }

  // ===== Modulation Matrix =====
  private applyModulation(state: SynthState): void {
    // Routes derive their ranges from these base values — include them all in
    // the change key so turning a knob re-centers its modulators.
    const key = JSON.stringify({
      routes: state.modulation ?? [],
      lfo1: [state.lfo1.rate, state.lfo1.waveform],
      lfo2: [state.lfo2.rate, state.lfo2.waveform],
      cutoff: state.filter.cutoff,
      reso: state.filter.resonance,
      vol: state.master.volume,
      rev: [state.effects.reverb.enabled, state.effects.reverb.mix],
      dly: [state.effects.delay.enabled, state.effects.delay.feedback],
    });
    if (this.modKey === key) return;
    this.modKey = key;

    // Full rebuild of this (small) LFO set, but only when the key changed.
    for (const lfo of this.modLFOs.values()) {
      lfo.stop();
      lfo.dispose();
    }
    this.modLFOs.clear();

    for (const route of state.modulation ?? []) {
      if (!route.enabled) continue;

      const sourceLfo = route.source === 'lfo1' ? state.lfo1 : state.lfo2;
      const target = this.getModTargetParam(route.destination);
      if (!target) continue;

      // Bipolar around 0: the param value holds the base; depth sets the
      // swing. Negative depth = inverted phase (up becomes down).
      const amt = Math.abs(route.depth) * bipolarRoom(target.base, target.min, target.max);

      const lfo = new Tone.LFO({
        frequency: sourceLfo.rate,
        type: sourceLfo.waveform,
        min: -amt,
        max: amt,
        phase: route.depth < 0 ? 180 : 0,
      });
      lfo.connect(target.param);
      lfo.start();
      this.modLFOs.set(route.id, lfo);
    }
  }

  private getModTargetParam(
    destination: ModDestination,
  ): { param: Tone.Param<any> | Tone.Signal<any>; base: number; min: number; max: number } | null {
    if (!this.state) return null;
    const s = this.state;
    switch (destination) {
      case 'filter.cutoff':
        return { param: this.filter.frequency, base: s.filter.cutoff, min: 20, max: 20000 };
      case 'filter.resonance':
        return {
          param: this.filter.Q,
          base: resonanceToQ(s.filter.resonance),
          min: 0.5,
          max: 18,
        };
      case 'master.volume':
        return { param: this.masterGain.gain, base: s.master.volume, min: 0, max: 1 };
      case 'effects.reverb.mix':
        return {
          param: this.reverb.wet,
          base: s.effects.reverb.enabled ? s.effects.reverb.mix : 0,
          min: 0,
          max: 1,
        };
      case 'effects.delay.feedback':
        return {
          param: this.delay.feedback,
          base: s.effects.delay.enabled ? s.effects.delay.feedback : 0,
          min: 0,
          max: 0.95,
        };
      default:
        return null;
    }
  }

  // ===== Note Triggering (Polyphonic) =====
  noteOn(midiNote: number, velocity = 100): void {
    if (!this.state) return;
    // If audio context is not yet unlocked, attempt to start.
    // If the underlying context is already 'running' (e.g. unlocked by a
    // prior gesture but our flag missed the transition), promote the flag
    // and continue so AI-triggered or rapid clicks aren't dropped.
    if (!this.started) {
      const ctxState = (Tone.getContext().rawContext as AudioContext).state;
      if (ctxState === 'running') {
        this.started = true;
      } else {
        void Tone.start().then(() => { this.started = true; });
        return;
      }
    }

    // If a voice already exists for this midi (re-pressed before release
    // timeout fired), release+dispose it immediately so the new voice
    // owns the map entry cleanly.
    const existing = this.voices.get(midiNote);
    if (existing) {
      this.voices.delete(midiNote);
      this.disposeVoice(existing);
    }

    // Steal oldest voice if at max
    if (this.voices.size >= this.maxVoices) {
      const oldest = this.voices.keys().next().value;
      if (oldest !== undefined) this.noteOff(oldest);
    }

    // Paraphonic filter envelope: retrigger per note; key tracking follows
    // the last played note (classic shared-filter behaviour).
    const f = this.state.filter;
    if (f.enabled) {
      if (f.keyTracking > 0) {
        const tracked = clamp(
          f.cutoff * Math.pow(2, ((midiNote - 60) / 12) * f.keyTracking),
          20,
          20000,
        );
        this.filter.frequency.setTargetAtTime(tracked, Tone.now(), 0.005);
      }
      if (f.envelopeAmount !== 0) {
        this.filterEnv.triggerAttack();
      }
    }

    const freq = midiToFrequency(midiNote);
    const voice = this.createVoice(freq, velocity / 127);
    this.voices.set(midiNote, voice);
    voice.ampEnvelope.triggerAttack(Tone.now(), velocity / 127);
  }

  noteOff(midiNote: number): void {
    const voice = this.voices.get(midiNote);
    if (!voice) return;

    // Remove from map immediately so noteOn can claim the slot for a
    // new press without waiting for release; the closure below disposes
    // the captured voice reference safely.
    this.voices.delete(midiNote);

    // Release the shared filter envelope only when the last voice lets go.
    if (this.voices.size === 0 && this.state?.filter.enabled) {
      this.filterEnv.triggerRelease();
    }

    const releaseTime = this.state?.ampEnvelope.release ?? 0.3;
    voice.ampEnvelope.triggerRelease();

    setTimeout(() => {
      this.disposeVoice(voice);
    }, (releaseTime + 0.1) * 1000);
  }

  private disposeVoice(voice: Voice): void {
    // Detach any per-voice LFO fan-out before disposing the nodes.
    for (const { lfo, perVoice } of this.activeLfos.values()) {
      if (perVoice) this.disconnectLfoFromVoice(lfo, perVoice, voice);
    }
    voice.oscillators.forEach((osc) => {
      try { osc.stop(); } catch { /* noop */ }
      osc.dispose();
    });
    voice.panners.forEach((p) => p.dispose());
    voice.gain.dispose();
    voice.ampEnvelope.dispose();
  }

  /** Stop all notes immediately */
  panic(): void {
    for (const midiNote of Array.from(this.voices.keys())) {
      this.noteOff(midiNote);
    }
  }

  private createVoice(frequency: number, velocityGain: number): Voice {
    const state = this.state!;
    const ampEnv = new Tone.AmplitudeEnvelope({
      attack: state.ampEnvelope.attack,
      decay: state.ampEnvelope.decay,
      sustain: state.ampEnvelope.sustain,
      release: state.ampEnvelope.release,
    });
    const gain = new Tone.Gain(velocityGain);

    const oscillators: Tone.Oscillator[] = [];
    const panners: Tone.Panner[] = [];

    for (const oscState of state.oscillators) {
      if (!oscState.enabled) continue;
      const { oscs, pans } = this.createOscillatorVoices(oscState, frequency);
      oscillators.push(...oscs);
      panners.push(...pans);
    }

    // Route: osc → panner → ampEnvelope → velocity gain → filter (→ FX chain)
    oscillators.forEach((osc, i) => {
      osc.connect(panners[i]);
      panners[i].connect(ampEnv);
    });
    ampEnv.connect(gain);
    gain.connect(this.filter);

    oscillators.forEach((osc) => osc.start());

    const voice: Voice = { oscillators, panners, gain, ampEnvelope: ampEnv, noteFrequency: frequency };

    // Attach live per-voice LFOs (pitch/pan) to the new voice.
    for (const { lfo, perVoice } of this.activeLfos.values()) {
      if (perVoice) this.connectLfoToVoice(lfo, perVoice, voice);
    }

    return voice;
  }

  private createOscillatorVoices(
    oscState: OscillatorState,
    baseFreq: number,
  ): { oscs: Tone.Oscillator[]; pans: Tone.Panner[] } {
    const semitoneRatio = Math.pow(2, oscState.semitone / 12);
    const fineRatio = Math.pow(2, oscState.fine / 1200);
    const freq = baseFreq * semitoneRatio * fineRatio;

    const type = oscState.type === 'custom' ? 'sawtooth' : oscState.type;
    const count = Math.max(1, oscState.unison);
    const perVoiceVolume = oscState.volume / Math.sqrt(count);

    const oscs: Tone.Oscillator[] = [];
    const pans: Tone.Panner[] = [];

    for (let i = 0; i < count; i++) {
      // Unison detune spread (cents) and stereo spread (±0.8 max) are both
      // centered on the oscillator's own detune/pan settings.
      const centered = i - (count - 1) / 2;
      const detuneOffset = count > 1 ? centered * (oscState.unisonSpread / count) : 0;
      const panOffset = count > 1 ? centered * (0.8 / count) : 0;

      // 2-arg constructor: the options-object overload is a discriminated
      // union on `type` that plain ToneOscillatorType doesn't satisfy.
      const osc = new Tone.Oscillator(freq, type as Tone.ToneOscillatorType);
      osc.volume.value = Tone.gainToDb(perVoiceVolume);
      osc.detune.value = oscState.detune + detuneOffset;

      const panner = new Tone.Panner(clamp(oscState.pan + panOffset, -1, 1));
      oscs.push(osc);
      pans.push(panner);
    }
    return { oscs, pans };
  }

  // ===== Analysis =====
  getWaveformData(): Float32Array {
    return this.analyserNode.getValue() as Float32Array;
  }

  getFFTData(): Float32Array {
    return this.fftAnalyser.getValue() as Float32Array;
  }

  // ===== Cleanup =====
  dispose(): void {
    this.panic();
    for (const index of [1, 2] as const) {
      this.removeLfo(index);
    }
    for (const lfo of this.modLFOs.values()) {
      lfo.stop();
      lfo.dispose();
    }
    this.modLFOs.clear();
    this.lfoKeys = { 1: '', 2: '' };
    this.modKey = '';

    this.filterEnv.dispose();
    this.filterEnvAmount.dispose();
    this.filter.dispose();
    for (const node of this.effectNodes.values()) {
      node.dispose();
    }
    this.masterGain.dispose();
    this.analyserNode.dispose();
    this.fftAnalyser.dispose();
  }
}

/** Singleton instance */
let engineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!engineInstance) {
    engineInstance = new AudioEngine();
  }
  return engineInstance;
}
