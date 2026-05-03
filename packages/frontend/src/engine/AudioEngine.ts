import * as Tone from 'tone';
import type {
  SynthState,
  OscillatorState,
  BasicWaveform,
  FilterType,
  LFOState,
  LFOTarget,
  EnvelopeState,
  EffectId,
  ModRoute,
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

interface Voice {
  oscillators: Tone.Oscillator[];
  gain: Tone.Gain;
  panner: Tone.Panner;
  ampEnvelope: Tone.AmplitudeEnvelope;
  noteFrequency: number;
}

/**
 * Core wavetable synthesizer engine built on Tone.js.
 * Manages oscillators, filter, envelopes, LFOs, and effects.
 */
export class AudioEngine {
  private context: Tone.BaseContext;
  private masterGain: Tone.Gain;
  private analyserNode: Tone.Waveform;
  private fftAnalyser: Tone.FFT;

  // Filter chain
  private filter: Tone.BiquadFilter;

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

  // LFOs
  private lfo1: Tone.LFO | null = null;
  private lfo2: Tone.LFO | null = null;
  /** Mod-matrix LFOs keyed by route id. */
  private modLFOs: Map<string, Tone.LFO> = new Map();

  // Polyphony
  private voices: Map<number, Voice> = new Map();
  private maxVoices = 16;

  // Current state reference
  private state: SynthState | null = null;

  // Transport for sequencer
  public transport = Tone.getTransport();

  private started = false;

  constructor() {
    this.context = Tone.getContext();

    // Master output chain: filter → effects → masterGain → analysers → destination
    this.masterGain = new Tone.Gain(0.75);
    this.analyserNode = new Tone.Waveform(2048);
    this.fftAnalyser = new Tone.FFT(2048);

    this.filter = new Tone.BiquadFilter({
      type: 'lowpass',
      frequency: 5000,
      Q: resonanceToQ(0.2),
    });

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
    this.bitCrusher = new Tone.BitCrusher({ bits: 8, wet: 0 });
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
    this.filter.type = f.type as BiquadFilterType;
    this.filter.frequency.value = f.enabled ? f.cutoff : 20000;
    this.filter.Q.value = resonanceToQ(f.resonance);
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
    this.masterGain.gain.value = state.master.volume;
    this.transport.bpm.value = state.master.bpm;
  }

  // ===== LFOs =====
  private applyLFOs(state: SynthState): void {
    this.applyLFO(state.lfo1, 1);
    this.applyLFO(state.lfo2, 2);
  }

  private applyLFO(lfoState: LFOState, index: 1 | 2): void {
    const existing = index === 1 ? this.lfo1 : this.lfo2;

    if (existing) {
      existing.stop();
      existing.dispose();
    }

    if (!lfoState.enabled) {
      if (index === 1) this.lfo1 = null;
      else this.lfo2 = null;
      return;
    }

    const target = this.getLFOTarget(lfoState.target);
    if (!target) return;

    const lfo = new Tone.LFO({
      frequency: lfoState.rate,
      type: lfoState.waveform,
      min: target.min,
      max: target.max,
    });

    lfo.connect(target.param);
    lfo.start();

    if (index === 1) this.lfo1 = lfo;
    else this.lfo2 = lfo;
  }

  private getLFOTarget(
    target: LFOTarget,
  ): { param: Tone.Param | Tone.Signal; min: number; max: number } | null {
    if (!this.state) return null;
    switch (target) {
      case 'filterCutoff': {
        const base = this.state.filter.cutoff;
        const depth = this.state.lfo1.depth;
        return {
          param: this.filter.frequency,
          min: Math.max(20, base * (1 - depth)),
          max: Math.min(20000, base * (1 + depth)),
        };
      }
      case 'volume':
        return {
          param: this.masterGain.gain,
          min: 0,
          max: this.state.master.volume,
        };
      default:
        return null;
    }
  }

  // ===== Modulation Matrix =====
  private applyModulation(state: SynthState): void {
    const routes = state.modulation ?? [];
    const seenIds = new Set<string>();

    for (const route of routes) {
      seenIds.add(route.id);
      const existing = this.modLFOs.get(route.id);
      if (existing) {
        existing.stop();
        existing.disconnect();
        existing.dispose();
        this.modLFOs.delete(route.id);
      }
      if (!route.enabled) continue;

      const sourceLfo = route.source === 'lfo1' ? state.lfo1 : state.lfo2;
      // Mod-matrix LFOs are independent of the legacy lfo1/lfo2 direct routing —
      // we read source's rate/waveform but still create a fresh Tone.LFO so this
      // route's depth doesn't fight the legacy LFO's own target wiring.
      const target = this.getModTargetParam(route.destination);
      if (!target) continue;

      const center = target.param.value as number;
      const range = (target.max - target.min) * route.depth;
      // Bipolar: oscillate around current value within ±range/2, clamped to limits.
      const min = Math.max(target.min, center - Math.abs(range) / 2);
      const max = Math.min(target.max, center + Math.abs(range) / 2);

      const lfo = new Tone.LFO({
        frequency: sourceLfo.rate,
        type: sourceLfo.waveform,
        min,
        max,
      });
      lfo.connect(target.param);
      lfo.start();
      this.modLFOs.set(route.id, lfo);
    }

    // Dispose any stale routes
    for (const [id, lfo] of this.modLFOs.entries()) {
      if (!seenIds.has(id)) {
        lfo.stop();
        lfo.disconnect();
        lfo.dispose();
        this.modLFOs.delete(id);
      }
    }
  }

  private getModTargetParam(
    destination: ModDestination,
  ): { param: Tone.Param<any> | Tone.Signal<any>; min: number; max: number } | null {
    switch (destination) {
      case 'filter.cutoff':
        return { param: this.filter.frequency, min: 20, max: 20000 };
      case 'filter.resonance':
        return { param: this.filter.Q, min: 0.5, max: 18 };
      case 'master.volume':
        return { param: this.masterGain.gain, min: 0, max: 1 };
      case 'effects.reverb.mix':
        return { param: this.reverb.wet, min: 0, max: 1 };
      case 'effects.delay.feedback':
        return { param: this.delay.feedback, min: 0, max: 0.95 };
      case 'effects.chorus.depth':
        // Tone.Chorus.depth is a number, not a Param — skip (no smooth modulation possible)
        return null;
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

    const releaseTime = this.state?.ampEnvelope.release ?? 0.3;
    voice.ampEnvelope.triggerRelease();

    setTimeout(() => {
      this.disposeVoice(voice);
    }, (releaseTime + 0.1) * 1000);
  }

  private disposeVoice(voice: Voice): void {
    voice.oscillators.forEach((osc) => {
      try { osc.stop(); } catch { /* noop */ }
      osc.dispose();
    });
    voice.gain.dispose();
    voice.panner.dispose();
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
    const panner = new Tone.Panner(0);

    const oscillators: Tone.Oscillator[] = [];

    for (const oscState of state.oscillators) {
      if (!oscState.enabled) continue;
      const oscs = this.createOscillatorVoices(oscState, frequency);
      oscillators.push(...oscs);
    }

    // Route: oscillators → ampEnvelope → gain → panner → filter (→ effects chain)
    oscillators.forEach((osc) => osc.connect(ampEnv));
    ampEnv.connect(gain);
    gain.connect(panner);
    panner.connect(this.filter);

    oscillators.forEach((osc) => osc.start());

    return { oscillators, gain, panner, ampEnvelope: ampEnv, noteFrequency: frequency };
  }

  private createOscillatorVoices(
    oscState: OscillatorState,
    baseFreq: number,
  ): Tone.Oscillator[] {
    const semitoneRatio = Math.pow(2, oscState.semitone / 12);
    const fineRatio = Math.pow(2, oscState.fine / 1200);
    const freq = baseFreq * semitoneRatio * fineRatio;

    const type = oscState.type === 'custom' ? 'sawtooth' : oscState.type;

    if (oscState.unison <= 1) {
      const osc = new Tone.Oscillator({
        frequency: freq,
        type: type as Tone.ToneOscillatorType,
        volume: Tone.gainToDb(oscState.volume),
        detune: oscState.detune,
      });
      return [osc];
    }

    // Unison voices
    const voices: Tone.Oscillator[] = [];
    const count = oscState.unison;
    const spreadPerVoice = oscState.unisonSpread / count;

    for (let i = 0; i < count; i++) {
      const detuneOffset = (i - (count - 1) / 2) * spreadPerVoice;
      const osc = new Tone.Oscillator({
        frequency: freq,
        type: type as Tone.ToneOscillatorType,
        volume: Tone.gainToDb(oscState.volume / Math.sqrt(count)),
        detune: oscState.detune + detuneOffset,
      });
      voices.push(osc);
    }
    return voices;
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
    this.lfo1?.stop();
    this.lfo1?.dispose();
    this.lfo2?.stop();
    this.lfo2?.dispose();
    for (const lfo of this.modLFOs.values()) {
      lfo.stop();
      lfo.dispose();
    }
    this.modLFOs.clear();

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
