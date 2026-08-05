// ===== Oscillator Types =====
export type BasicWaveform = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type WaveformType = BasicWaveform | 'custom';

export interface OscillatorState {
  id: string;
  enabled: boolean;
  type: WaveformType;
  /** Wavetable morph position 0-1 (only for custom type) */
  wavetablePosition: number;
  /** Detune in cents (-1200 to 1200) */
  detune: number;
  /** Semitone offset (-24 to 24) */
  semitone: number;
  /** Fine tune in cents (-100 to 100) */
  fine: number;
  /** Volume 0-1 */
  volume: number;
  /** Pan -1 to 1 */
  pan: number;
  /** Unison voices count */
  unison: number;
  /** Unison detune spread in cents */
  unisonSpread: number;
}

// ===== Filter Types =====
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

export interface FilterState {
  enabled: boolean;
  type: FilterType;
  /** Cutoff frequency in Hz (20-20000) */
  cutoff: number;
  /** Resonance / Q factor (0-1, mapped to 0.1-25) */
  resonance: number;
  /** Filter envelope amount (-1 to 1) */
  envelopeAmount: number;
  /** Key tracking amount (0-1) */
  keyTracking: number;
}

// ===== Envelope Types =====
export interface EnvelopeState {
  /** Attack time in seconds (0.001-5) */
  attack: number;
  /** Decay time in seconds (0.001-5) */
  decay: number;
  /** Sustain level (0-1) */
  sustain: number;
  /** Release time in seconds (0.001-10) */
  release: number;
}

// ===== LFO Types =====
export type LFOWaveform = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type LFOTarget =
  | 'filterCutoff'
  | 'volume'
  | 'pan'
  | 'pitch';

export interface LFOState {
  enabled: boolean;
  waveform: LFOWaveform;
  /** Rate in Hz (0.01-50) */
  rate: number;
  /** Depth 0-1 */
  depth: number;
  /** Target parameter */
  target: LFOTarget;
  /** Sync to tempo */
  sync: boolean;
}

// ===== Modulation Matrix =====
export type ModSource = 'lfo1' | 'lfo2';
export type ModDestination =
  | 'filter.cutoff'
  | 'filter.resonance'
  | 'master.volume'
  | 'effects.reverb.mix'
  | 'effects.delay.feedback';

export interface ModRoute {
  id: string;
  enabled: boolean;
  source: ModSource;
  destination: ModDestination;
  /** Bipolar depth -1..1 */
  depth: number;
}

// ===== Effects Types =====
export interface ReverbState {
  enabled: boolean;
  /** Room size 0-1 */
  size: number;
  /** Damping 0-1 */
  damping: number;
  /** Wet/Dry mix 0-1 */
  mix: number;
}

export interface DelayState {
  enabled: boolean;
  /** Delay time in seconds (0.01-2) */
  time: number;
  /** Feedback 0-0.95 */
  feedback: number;
  /** Wet/Dry mix 0-1 */
  mix: number;
}

export interface ChorusState {
  enabled: boolean;
  /** Rate in Hz (0.1-10) */
  rate: number;
  /** Depth 0-1 */
  depth: number;
  /** Wet/Dry mix 0-1 */
  mix: number;
}

export interface DistortionState {
  enabled: boolean;
  /** Drive amount 0-1 */
  drive: number;
  /** Wet/Dry mix 0-1 */
  mix: number;
}

export interface CompressorState {
  enabled: boolean;
  /** Threshold in dB (-60 to 0) */
  threshold: number;
  /** Ratio (1-20) */
  ratio: number;
  /** Attack in seconds (0.001-1) */
  attack: number;
  /** Release in seconds (0.01-1) */
  release: number;
}

export interface EQ3State {
  enabled: boolean;
  /** Low gain dB (-24 to 24) */
  low: number;
  /** Mid gain dB (-24 to 24) */
  mid: number;
  /** High gain dB (-24 to 24) */
  high: number;
  /** Low/Mid crossover Hz (50-1000) */
  lowFrequency: number;
  /** Mid/High crossover Hz (1000-10000) */
  highFrequency: number;
}

export interface PhaserState {
  enabled: boolean;
  rate: number;        // Hz 0.1-10
  depth: number;       // 0-1
  baseFrequency: number; // Hz 20-2000
  octaves: number;     // 1-7
  mix: number;         // 0-1
}

export interface BitCrusherState {
  enabled: boolean;
  bits: number;        // 1-16
  mix: number;         // 0-1
}

export interface StereoWidenerState {
  enabled: boolean;
  width: number;       // 0-1
}

export interface EffectsState {
  reverb: ReverbState;
  delay: DelayState;
  chorus: ChorusState;
  distortion: DistortionState;
  compressor: CompressorState;
  eq3: EQ3State;
  phaser: PhaserState;
  bitCrusher: BitCrusherState;
  stereoWidener: StereoWidenerState;
}

/** All effect ids in canonical default order. */
export type EffectId =
  | 'distortion'
  | 'bitCrusher'
  | 'eq3'
  | 'chorus'
  | 'phaser'
  | 'delay'
  | 'reverb'
  | 'stereoWidener'
  | 'compressor';

export const DEFAULT_EFFECT_CHAIN: EffectId[] = [
  'distortion',
  'bitCrusher',
  'eq3',
  'chorus',
  'phaser',
  'delay',
  'reverb',
  'stereoWidener',
  'compressor',
];

// ===== Master =====
export interface MasterState {
  /** Master volume 0-1 */
  volume: number;
  /** BPM for sequencer */
  bpm: number;
}

// ===== Complete Synth State =====
export interface SynthState {
  oscillators: [OscillatorState, OscillatorState, OscillatorState];
  filter: FilterState;
  ampEnvelope: EnvelopeState;
  filterEnvelope: EnvelopeState;
  lfo1: LFOState;
  lfo2: LFOState;
  effects: EffectsState;
  /** Order of effects in the chain. If missing on legacy state, the default order is used. */
  effectChain?: EffectId[];
  /** User-defined modulation routes (mod matrix). */
  modulation?: ModRoute[];
  master: MasterState;
}

// ===== Sequencer Types =====
export interface SequencerNote {
  /** MIDI note number (0-127) */
  note: number;
  /** Velocity (0-127) */
  velocity: number;
  /** Start time in steps */
  start: number;
  /** Duration in steps */
  duration: number;
}

export interface SequencerPattern {
  id: string;
  name: string;
  steps: number;
  notes: SequencerNote[];
}

export interface SequencerState {
  playing: boolean;
  recording: boolean;
  bpm: number;
  currentStep: number;
  patterns: SequencerPattern[];
  activePatternId: string;
}

// ===== Preset =====
export interface Preset {
  id: string;
  name: string;
  author?: string;
  tags: string[];
  synthState: SynthState;
  createdAt: number;
  updatedAt: number;
}

// ===== Note Helpers =====
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

export function noteNameToMidi(name: string): number {
  const match = name.match(/^([A-G]#?)(\d+)$/);
  if (!match) return 60;
  const [, note, octave] = match;
  const noteIndex = NOTE_NAMES.indexOf(note as typeof NOTE_NAMES[number]);
  return (parseInt(octave) + 1) * 12 + noteIndex;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
