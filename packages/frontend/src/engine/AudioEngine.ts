import * as Tone from 'tone';
import type {
  SynthState,
  OscillatorState,
  LFOState,
  EffectId,
  ModDestination,
  SequencerPattern,
  SequencerNote,
} from './types';
import { midiToFrequency, DEFAULT_EFFECT_CHAIN } from './types';
import { WAVETABLES, framePair } from './wavetables';

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

/**
 * One audible oscillator unit: a single oscillator for basic waveforms, or
 * a frame A/B pair crossfading for wavetable (custom) mode.
 */
interface VoiceUnit {
  oscs: Tone.Oscillator[];
  panner: Tone.Panner;
  /** Which synth oscillator slot (0-2) this unit belongs to. */
  oscIndex: number;
  /** Current morph frame pair (wavetable mode; -1 = n/a for basic types). */
  frameA: number;
  frameB: number;
  /** FM depth node (carrier units only): modulator signal → osc frequency. */
  fmGain?: Tone.Gain;
}

interface Voice {
  units: VoiceUnit[];
  gain: Tone.Gain;
  ampEnvelope: Tone.AmplitudeEnvelope;
  noteFrequency: number;
}

/** Equal-power crossfade gains for the wavetable morph pair. */
function morphGains(blend: number): [number, number] {
  return [Math.cos((blend * Math.PI) / 2), Math.sin((blend * Math.PI) / 2)];
}

/** dB conversion that never returns -Infinity (breaks exponential ramps). */
function toDbSafe(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-4));
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

  // Step sequencer (Tone.Part on the shared Transport)
  private seqPart: Tone.Part<[string, SequencerNote]> | null = null;
  private seqStepEventId: number | null = null;
  private seqStepCounter = 0;
  private seqSteps = 16;
  /** UI hook: called (via Tone.Draw) with the current step while playing. */
  onStep: ((step: number) => void) | null = null;

  // Current state reference
  private state: SynthState | null = null;

  // Change-detection keys so applyState() doesn't rebuild modulators
  // (and reset their phase) or re-ramp unchanged sections on every edit.
  private lfoKeys: Record<1 | 2, string> = { 1: '', 2: '' };
  private modKey = '';
  private filterKey = '';
  private masterKey = '';
  private effectKeys: Partial<Record<EffectId, string>> = {};

  // Transport for sequencer
  public transport = Tone.getTransport();

  private started = false;
  /**
   * Offline-render mode: no wall-clock voice disposal (OfflineAudioContext
   * renders faster than real time, so setTimeout-based cleanup would fire
   * mid-render and cut release tails). The whole context is discarded after
   * rendering, making disposal unnecessary.
   */
  private offlineMode = false;

  /** Mark the engine ready for offline rendering (no user gesture exists). */
  markOffline(): void {
    this.started = true;
    this.offlineMode = true;
  }

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
    this.applyVoices(state);
  }

  /** Smooth a continuous param (30ms default) to avoid zipper noise. */
  private static ramp(
    param: Tone.Param<any> | Tone.Signal<any>,
    value: number,
    tc = 0.03,
  ): void {
    param.setTargetAtTime(value, Tone.now(), tc);
  }

  private effectChanged(id: EffectId, fxState: unknown): boolean {
    const key = JSON.stringify(fxState);
    if (this.effectKeys[id] === key) return false;
    this.effectKeys[id] = key;
    return true;
  }

  // ===== Filter =====
  private applyFilter(state: SynthState): void {
    const key = JSON.stringify([state.filter, state.filterEnvelope]);
    if (this.filterKey === key) return;
    this.filterKey = key;

    const f = state.filter;
    this.filter.type = f.type as BiquadFilterType;
    // Smooth ramps avoid zipper noise on knob drags. When the filter is
    // disabled we park it fully open at 20 kHz.
    const base = f.enabled ? f.cutoff : 20000;
    AudioEngine.ramp(this.filter.frequency, base, 0.02);
    AudioEngine.ramp(this.filter.Q, resonanceToQ(f.resonance), 0.02);

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

    // Each effect is guarded by a change key: untouched effects are skipped
    // entirely, and continuous params ramp smoothly instead of stepping.
    if (this.effectChanged('reverb', fx.reverb)) {
      AudioEngine.ramp(this.reverb.wet, fx.reverb.enabled ? fx.reverb.mix : 0);
      // Reverb: size 0-1 → decay 0.1-10s; damping 0-1 → preDelay 0-0.1s
      const newDecay = Math.max(0.1, 0.1 + fx.reverb.size * 9.9);
      // Tone.Reverb.decay is a number setter — only re-set when changed (it triggers IR regen).
      if (Math.abs((this.reverb.decay as number) - newDecay) > 0.01) {
        this.reverb.decay = newDecay;
      }
      this.reverb.preDelay = fx.reverb.damping * 0.1;
    }

    if (this.effectChanged('delay', fx.delay)) {
      AudioEngine.ramp(this.delay.wet, fx.delay.enabled ? fx.delay.mix : 0);
      // Slower glide on delay time — tape-style pitch slide while moving.
      AudioEngine.ramp(this.delay.delayTime, fx.delay.time, 0.06);
      AudioEngine.ramp(this.delay.feedback, fx.delay.feedback);
    }

    if (this.effectChanged('chorus', fx.chorus)) {
      AudioEngine.ramp(this.chorus.wet, fx.chorus.enabled ? fx.chorus.mix : 0);
      AudioEngine.ramp(this.chorus.frequency, fx.chorus.rate);
      this.chorus.depth = fx.chorus.depth;
    }

    if (this.effectChanged('distortion', fx.distortion)) {
      AudioEngine.ramp(this.distortion.wet, fx.distortion.enabled ? fx.distortion.mix : 0);
      this.distortion.distortion = fx.distortion.drive;
    }

    if (this.effectChanged('compressor', fx.compressor)) {
      AudioEngine.ramp(this.compressor.threshold, fx.compressor.enabled ? fx.compressor.threshold : 0);
      AudioEngine.ramp(this.compressor.ratio, fx.compressor.enabled ? fx.compressor.ratio : 1);
      this.compressor.attack.value = fx.compressor.attack;
      this.compressor.release.value = fx.compressor.release;
    }

    if (this.effectChanged('eq3', fx.eq3)) {
      // When disabled, flatten gains (kept in chain so reorder is consistent)
      AudioEngine.ramp(this.eq3.low, fx.eq3.enabled ? fx.eq3.low : 0);
      AudioEngine.ramp(this.eq3.mid, fx.eq3.enabled ? fx.eq3.mid : 0);
      AudioEngine.ramp(this.eq3.high, fx.eq3.enabled ? fx.eq3.high : 0);
      AudioEngine.ramp(this.eq3.lowFrequency, fx.eq3.lowFrequency);
      AudioEngine.ramp(this.eq3.highFrequency, fx.eq3.highFrequency);
    }

    if (this.effectChanged('phaser', fx.phaser)) {
      AudioEngine.ramp(this.phaser.wet, fx.phaser.enabled ? fx.phaser.mix : 0);
      AudioEngine.ramp(this.phaser.frequency, fx.phaser.rate);
      this.phaser.octaves = fx.phaser.octaves;
      this.phaser.baseFrequency = fx.phaser.baseFrequency;
    }

    if (this.effectChanged('bitCrusher', fx.bitCrusher)) {
      AudioEngine.ramp(this.bitCrusher.wet, fx.bitCrusher.enabled ? fx.bitCrusher.mix : 0);
      this.bitCrusher.bits.value = fx.bitCrusher.bits;
    }

    if (this.effectChanged('stereoWidener', fx.stereoWidener)) {
      // When disabled, width=0.5 = neutral mono-ish; we use 0.5 baseline
      AudioEngine.ramp(this.stereoWidener.width, fx.stereoWidener.enabled ? fx.stereoWidener.width : 0.5);
    }

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
    const key = JSON.stringify(state.master);
    if (this.masterKey === key) return;
    this.masterKey = key;
    AudioEngine.ramp(this.masterGain.gain, state.master.volume, 0.02);
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
        if (!this.state.filter.enabled) return null; // filter parked open — nothing to wobble
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
      for (const unit of voice.units) {
        for (const osc of unit.oscs) lfo.connect(osc.detune);
      }
    } else {
      for (const unit of voice.units) lfo.connect(unit.panner.pan);
    }
  }

  private disconnectLfoFromVoice(lfo: Tone.LFO, target: PerVoiceTarget, voice: Voice): void {
    try {
      if (target === 'detune') {
        for (const unit of voice.units) {
          for (const osc of unit.oscs) lfo.disconnect(osc.detune);
        }
      } else {
        for (const unit of voice.units) lfo.disconnect(unit.panner.pan);
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
      filterOn: state.filter.enabled,
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
        if (!s.filter.enabled) return null;
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

  // ===== Live Voice Updates =====
  /**
   * Push oscillator parameter changes into currently sounding voices, so
   * turning a knob (or the agent setting a param) is heard immediately on
   * held notes instead of only on the next trigger. Voices whose structure
   * no longer matches (enabled flags / unison counts changed) keep their
   * birth timbre; the new structure applies to the next note.
   */
  private applyVoices(state: SynthState): void {
    if (this.voices.size === 0) return;
    const now = Tone.now();
    for (const voice of this.voices.values()) {
      const expected = state.oscillators.reduce(
        (n, o) => n + (o.enabled ? Math.max(1, o.unison) : 0),
        0,
      );
      if (expected !== voice.units.length) continue;

      let mismatch = false;
      let i = 0;
      for (let oscIdx = 0; oscIdx < state.oscillators.length && !mismatch; oscIdx++) {
        const oscState = state.oscillators[oscIdx];
        if (!oscState.enabled) continue;
        const count = Math.max(1, oscState.unison);
        const isCustom = oscState.type === 'custom';
        const table = isCustom ? (WAVETABLES[oscState.wavetable] ?? WAVETABLES.morph) : null;
        const freq =
          voice.noteFrequency *
          Math.pow(2, oscState.semitone / 12) *
          Math.pow(2, oscState.fine / 1200);
        const perVoiceVolume = oscState.volume / Math.sqrt(count);
        const pair = table ? framePair(table, oscState.wavetablePosition) : null;
        const gains = pair ? morphGains(pair.blend) : null;

        for (let u = 0; u < count; u++, i++) {
          const unit = voice.units[i];
          if (!unit || unit.oscIndex !== oscIdx || unit.oscs.length !== (isCustom ? 2 : 1)) {
            mismatch = true; // structure changed — keep birth timbre, next note gets it
            break;
          }
          const centered = u - (count - 1) / 2;
          const detuneOffset = count > 1 ? centered * (oscState.unisonSpread / count) : 0;
          const panOffset = count > 1 ? centered * (0.8 / count) : 0;

          if (table && pair && gains) {
            const [oscA, oscB] = unit.oscs;
            // Cross a frame boundary → retable the morph pair (cached waves).
            if (unit.frameA !== pair.frameA) {
              oscA.partials = table.frames[pair.frameA];
              unit.frameA = pair.frameA;
            }
            if (unit.frameB !== pair.frameB) {
              oscB.partials = table.frames[pair.frameB];
              unit.frameB = pair.frameB;
            }
            oscA.frequency.setTargetAtTime(freq, now, 0.02);
            oscB.frequency.setTargetAtTime(freq, now, 0.02);
            oscA.detune.setTargetAtTime(oscState.detune + detuneOffset, now, 0.02);
            oscB.detune.setTargetAtTime(oscState.detune + detuneOffset, now, 0.02);
            oscA.volume.setTargetAtTime(toDbSafe(perVoiceVolume * gains[0]), now, 0.03);
            oscB.volume.setTargetAtTime(toDbSafe(perVoiceVolume * gains[1]), now, 0.03);
          } else {
            const osc = unit.oscs[0];
            osc.frequency.setTargetAtTime(freq, now, 0.02);
            osc.detune.setTargetAtTime(oscState.detune + detuneOffset, now, 0.02);
            osc.volume.setTargetAtTime(
              Math.max(-60, Tone.gainToDb(perVoiceVolume)),
              now,
              0.03,
            );
          }
          unit.panner.pan.setTargetAtTime(clamp(oscState.pan + panOffset, -1, 1), now, 0.03);
          // Live FM depth update (units created with fmAmount=0 have no
          // node yet — they keep their birth timbre until the next note).
          if (oscIdx === 0 && unit.fmGain) {
            unit.fmGain.gain.setTargetAtTime(oscState.fmAmount * freq * 2, now, 0.03);
          }
        }
      }
    }
  }

  // ===== Note Triggering (Polyphonic) =====
  /**
   * @param when Optional precise audio time (used by the sequencer);
   *             defaults to "now" for live playing.
   */
  noteOn(midiNote: number, velocity = 100, when?: number): void {
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
    // timeout fired, or the sequencer retriggered the same pitch), fade it
    // out quickly instead of hard-disposing (avoids an audible click).
    const now = Tone.now();
    const at = when ?? now;
    const existing = this.voices.get(midiNote);
    if (existing) {
      this.voices.delete(midiNote);
      try {
        existing.ampEnvelope.triggerRelease(at);
      } catch { /* already released */ }
      if (!this.offlineMode) {
        setTimeout(() => this.disposeVoice(existing), 300);
      }
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
        this.filter.frequency.setTargetAtTime(tracked, at, 0.005);
      }
      if (f.envelopeAmount !== 0) {
        this.filterEnv.triggerAttack(at);
      }
    }

    const freq = midiToFrequency(midiNote);
    const voice = this.createVoice(freq, velocity / 127);
    this.voices.set(midiNote, voice);
    voice.ampEnvelope.triggerAttack(at, velocity / 127);
  }

  noteOff(midiNote: number, when?: number): void {
    const voice = this.voices.get(midiNote);
    if (!voice) return;

    // Remove from map immediately so noteOn can claim the slot for a
    // new press without waiting for release; the closure below disposes
    // the captured voice reference safely.
    this.voices.delete(midiNote);

    // Release the shared filter envelope only when the last voice lets go.
    if (this.voices.size === 0 && this.state?.filter.enabled) {
      this.filterEnv.triggerRelease(when);
    }

    const now = Tone.now();
    const at = when ?? now;
    const releaseTime = this.state?.ampEnvelope.release ?? 0.3;
    voice.ampEnvelope.triggerRelease(at);

    // Disposal waits for both a future scheduled release and the tail.
    if (!this.offlineMode) {
      const disposeInMs = Math.max(0, (at - now) * 1000) + (releaseTime + 0.1) * 1000;
      setTimeout(() => {
        this.disposeVoice(voice);
      }, disposeInMs);
    }
  }

  private disposeVoice(voice: Voice): void {
    // Detach any per-voice LFO fan-out before disposing the nodes.
    for (const { lfo, perVoice } of this.activeLfos.values()) {
      if (perVoice) this.disconnectLfoFromVoice(lfo, perVoice, voice);
    }
    for (const unit of voice.units) {
      unit.oscs.forEach((osc) => {
        try { osc.stop(); } catch { /* noop */ }
        osc.dispose();
      });
      unit.panner.dispose();
      unit.fmGain?.dispose();
    }
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

    const units: VoiceUnit[] = [];
    state.oscillators.forEach((oscState, oscIndex) => {
      if (!oscState.enabled) return;
      units.push(...this.createOscillatorVoices(oscState, oscIndex, frequency));
    });

    // Route: unit oscs → unit panner → ampEnvelope → velocity gain → filter (→ FX)
    for (const unit of units) {
      for (const osc of unit.oscs) osc.connect(unit.panner);
      unit.panner.connect(ampEnv);
    }
    ampEnv.connect(gain);
    gain.connect(this.filter);

    // FM: OSC2 → OSC1 (audio-rate). Post-volume tap, so OSC2's level acts
    // as the modulation index. Unison pairs are matched round-robin.
    const fmAmount = state.oscillators[0].fmAmount;
    const carrierUnits = units.filter((u) => u.oscIndex === 0);
    const modUnits = units.filter((u) => u.oscIndex === 1);
    if (fmAmount > 0 && carrierUnits.length > 0 && modUnits.length > 0) {
      carrierUnits.forEach((cu, i) => {
        const mu = modUnits[i % modUnits.length];
        const fmGain = new Tone.Gain(fmAmount * frequency * 2);
        for (const osc of mu.oscs) osc.connect(fmGain);
        for (const osc of cu.oscs) fmGain.connect(osc.frequency);
        cu.fmGain = fmGain;
      });
    }

    for (const unit of units) {
      for (const osc of unit.oscs) osc.start();
    }

    const voice: Voice = { units, gain, ampEnvelope: ampEnv, noteFrequency: frequency };

    // Attach live per-voice LFOs (pitch/pan) to the new voice.
    for (const { lfo, perVoice } of this.activeLfos.values()) {
      if (perVoice) this.connectLfoToVoice(lfo, perVoice, voice);
    }

    return voice;
  }

  private createOscillatorVoices(
    oscState: OscillatorState,
    oscIndex: number,
    baseFreq: number,
  ): VoiceUnit[] {
    const freq =
      baseFreq *
      Math.pow(2, oscState.semitone / 12) *
      Math.pow(2, oscState.fine / 1200);
    const count = Math.max(1, oscState.unison);
    const perVoiceVolume = oscState.volume / Math.sqrt(count);
    const isCustom = oscState.type === 'custom';
    const table = isCustom ? (WAVETABLES[oscState.wavetable] ?? WAVETABLES.morph) : null;

    const units: VoiceUnit[] = [];
    for (let i = 0; i < count; i++) {
      // Unison detune spread (cents) and stereo spread (±0.8 max) are both
      // centered on the oscillator's own detune/pan settings.
      const centered = i - (count - 1) / 2;
      const detuneOffset = count > 1 ? centered * (oscState.unisonSpread / count) : 0;
      const panOffset = count > 1 ? centered * (0.8 / count) : 0;
      const panner = new Tone.Panner(clamp(oscState.pan + panOffset, -1, 1));

      if (table) {
        // Wavetable morph: frame A/B pair with equal-power crossfade.
        const { frameA, frameB, blend } = framePair(table, oscState.wavetablePosition);
        const [gA, gB] = morphGains(blend);
        const oscA = new Tone.Oscillator(freq, 'sawtooth');
        oscA.partials = table.frames[frameA];
        oscA.detune.value = oscState.detune + detuneOffset;
        oscA.volume.value = toDbSafe(perVoiceVolume * gA);
        const oscB = new Tone.Oscillator(freq, 'sawtooth');
        oscB.partials = table.frames[frameB];
        oscB.detune.value = oscState.detune + detuneOffset;
        oscB.volume.value = toDbSafe(perVoiceVolume * gB);
        units.push({ oscs: [oscA, oscB], panner, oscIndex, frameA, frameB });
      } else {
        // 2-arg constructor: the options-object overload is a discriminated
        // union on `type` that plain ToneOscillatorType doesn't satisfy.
        const osc = new Tone.Oscillator(freq, oscState.type as Tone.ToneOscillatorType);
        osc.volume.value = Tone.gainToDb(perVoiceVolume);
        osc.detune.value = oscState.detune + detuneOffset;
        units.push({ oscs: [osc], panner, oscIndex, frameA: -1, frameB: -1 });
      }
    }
    return units;
  }

  // ===== Step Sequencer =====
  /** Convert a step index to Transport time (bars:beats:sixteenths). */
  private static stepToTransportTime(step: number): string {
    const bar = Math.floor(step / 16);
    const rem = step % 16;
    return `${bar}:${Math.floor(rem / 4)}:${rem % 4}`;
  }

  /**
   * (Re)build the looping pattern part. If the sequencer is currently
   * playing, playback resumes seamlessly with the new pattern.
   */
  setSequencerPattern(pattern: SequencerPattern | null): void {
    const wasPlaying = this.transport.state === 'started';
    this.teardownSequencerPart();
    if (!pattern || pattern.notes.length === 0) return;

    this.seqSteps = pattern.steps;
    const events = pattern.notes.map(
      (n) => [AudioEngine.stepToTransportTime(n.start), n] as [string, SequencerNote],
    );
    this.seqPart = new Tone.Part<[string, SequencerNote]>((time, value) => {
      const secPerStep = 60 / (this.transport.bpm.value as number) / 4;
      this.noteOn(value.note, value.velocity, time);
      this.noteOff(value.note, time + value.duration * secPerStep);
    }, events);
    this.seqPart.loop = true;
    this.seqPart.loopEnd = AudioEngine.stepToTransportTime(pattern.steps);

    if (wasPlaying) {
      this.seqPart.start(0);
      this.seqStepCounter = Math.round(
        Tone.Time(this.transport.position as Tone.Unit.Time).toSeconds() /
          (60 / (this.transport.bpm.value as number) / 4),
      );
    }
  }

  startSequencer(): void {
    if (!this.seqPart) return;
    this.seqStepCounter = 0;
    if (this.seqStepEventId === null) {
      this.seqStepEventId = this.transport.scheduleRepeat((time) => {
        const step = this.seqStepCounter % this.seqSteps;
        this.seqStepCounter++;
        Tone.getDraw().schedule(() => this.onStep?.(step), time);
      }, '16n');
    }
    this.transport.start('+0.1');
    this.seqPart.start('+0.1');
  }

  stopSequencer(): void {
    this.seqPart?.stop();
    if (this.seqStepEventId !== null) {
      this.transport.clear(this.seqStepEventId);
      this.seqStepEventId = null;
    }
    this.transport.stop();
    this.transport.position = 0;
    this.panic();
  }

  isSequencerPlaying(): boolean {
    return this.transport.state === 'started';
  }

  private teardownSequencerPart(): void {
    if (this.seqPart) {
      this.seqPart.stop();
      this.seqPart.dispose();
      this.seqPart = null;
    }
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
    this.stopSequencer();
    this.teardownSequencerPart();
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
    this.filterKey = '';
    this.masterKey = '';
    this.effectKeys = {};

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
