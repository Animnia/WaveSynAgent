import type { SynthState } from './types';
import { DEFAULT_EFFECT_CHAIN } from './types';

export function createDefaultSynthState(): SynthState {
  return {
    oscillators: [
      {
        id: 'osc1',
        enabled: true,
        type: 'sawtooth',
        wavetable: 'morph',
        wavetablePosition: 0,
        detune: 0,
        semitone: 0,
        fine: 0,
        volume: 0.8,
        fmAmount: 0,
        pan: 0,
        unison: 1,
        unisonSpread: 10,
      },
      {
        id: 'osc2',
        enabled: false,
        type: 'square',
        wavetable: 'morph',
        wavetablePosition: 0,
        detune: 0,
        semitone: 0,
        fine: 5,
        volume: 0.5,
        fmAmount: 0,
        pan: 0,
        unison: 1,
        unisonSpread: 10,
      },
      {
        id: 'osc3',
        enabled: false,
        type: 'sine',
        wavetable: 'morph',
        wavetablePosition: 0,
        detune: 0,
        semitone: -12,
        fine: 0,
        volume: 0.4,
        fmAmount: 0,
        pan: 0,
        unison: 1,
        unisonSpread: 10,
      },
    ],
    filter: {
      enabled: true,
      type: 'lowpass',
      cutoff: 5000,
      resonance: 0.2,
      envelopeAmount: 0.3,
      keyTracking: 0,
    },
    ampEnvelope: {
      attack: 0.01,
      decay: 0.3,
      sustain: 0.7,
      release: 0.3,
    },
    filterEnvelope: {
      attack: 0.05,
      decay: 0.4,
      sustain: 0.3,
      release: 0.5,
    },
    lfo1: {
      enabled: false,
      waveform: 'sine',
      rate: 2,
      depth: 0.3,
      target: 'filterCutoff',
      sync: false,
    },
    lfo2: {
      enabled: false,
      waveform: 'triangle',
      rate: 0.5,
      depth: 0.2,
      target: 'pan',
      sync: false,
    },
    effects: {
      reverb: { enabled: false, size: 0.5, damping: 0.5, mix: 0.3 },
      delay: { enabled: false, time: 0.375, feedback: 0.4, mix: 0.25 },
      chorus: { enabled: false, rate: 1.5, depth: 0.5, mix: 0.3 },
      distortion: { enabled: false, drive: 0.3, mix: 0.5 },
      compressor: {
        enabled: false,
        threshold: -24,
        ratio: 4,
        attack: 0.003,
        release: 0.25,
      },
      eq3: {
        enabled: false,
        low: 0,
        mid: 0,
        high: 0,
        lowFrequency: 400,
        highFrequency: 2500,
      },
      phaser: {
        enabled: false,
        rate: 0.5,
        depth: 0.7,
        baseFrequency: 350,
        octaves: 3,
        mix: 0.4,
      },
      bitCrusher: { enabled: false, bits: 8, mix: 0.5 },
      stereoWidener: { enabled: false, width: 0.5 },
    },
    effectChain: [...DEFAULT_EFFECT_CHAIN],
    modulation: [],
    master: {
      volume: 0.75,
      bpm: 120,
    },
  };
}

/**
 * Merge a (possibly partial / legacy) stored state over the defaults.
 * Presets saved before new fields existed (e.g. `wavetable`) stay loadable.
 */
export function normalizeSynthState(input: unknown): SynthState {
  const defaults = createDefaultSynthState();
  if (!input || typeof input !== 'object') return defaults;
  const s = input as Partial<SynthState>;

  const section = <K extends keyof SynthState>(key: K): SynthState[K] => ({
    ...(defaults[key] as object),
    ...((s[key] ?? {}) as object),
  }) as SynthState[K];

  const normalized: SynthState = {
    ...defaults,
    oscillators: defaults.oscillators.map((def, i) => ({
      ...def,
      ...((s.oscillators?.[i] ?? {}) as Partial<typeof def>),
    })) as SynthState['oscillators'],
    filter: section('filter'),
    ampEnvelope: section('ampEnvelope'),
    filterEnvelope: section('filterEnvelope'),
    lfo1: section('lfo1'),
    lfo2: section('lfo2'),
    effects: Object.fromEntries(
      Object.entries(defaults.effects).map(([fxId, defFx]) => [
        fxId,
        { ...defFx, ...((s.effects?.[fxId as keyof typeof s.effects] ?? {}) as object) },
      ]),
    ) as SynthState['effects'],
    effectChain:
      Array.isArray(s.effectChain) && s.effectChain.length === DEFAULT_EFFECT_CHAIN.length
        ? s.effectChain
        : [...DEFAULT_EFFECT_CHAIN],
    modulation: Array.isArray(s.modulation) ? s.modulation : [],
    master: section('master'),
  };
  return normalized;
}
