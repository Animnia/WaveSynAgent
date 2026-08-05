import type { ModDestination, ModSource } from './types';

/**
 * Metadata for each modulation destination — for UI display and engine lookup.
 * The actual `Tone.Param` reference is fetched dynamically from the AudioEngine
 * because the engine owns those node instances.
 */
export interface ModTargetSpec {
  id: ModDestination;
  label: string;
  /** Min and max for the modulated value (used to translate ±1 LFO into a range). */
  min: number;
  max: number;
  /** Whether the parameter scales logarithmically (e.g. cutoff frequency). */
  logarithmic?: boolean;
}

export const MOD_TARGETS: ModTargetSpec[] = [
  { id: 'filter.cutoff',         label: 'Filter Cutoff',  min: 20,    max: 20000, logarithmic: true },
  { id: 'filter.resonance',      label: 'Filter Reso',    min: 0,     max: 1 },
  { id: 'master.volume',         label: 'Master Volume',  min: 0,     max: 1 },
  { id: 'effects.reverb.mix',    label: 'Reverb Mix',     min: 0,     max: 1 },
  { id: 'effects.delay.feedback',label: 'Delay Feedback', min: 0,     max: 0.95 },
  { id: 'effects.phaser.rate',   label: 'Phaser Rate',    min: 0.1,   max: 10 },
  { id: 'effects.chorus.rate',   label: 'Chorus Rate',    min: 0.1,   max: 10 },
  { id: 'voices.pitch',          label: 'Pitch (voices)', min: -100,  max: 100 },
  { id: 'voices.pan',            label: 'Pan (voices)',   min: -1,    max: 1 },
];

export const MOD_SOURCES: { id: ModSource; label: string }[] = [
  { id: 'lfo1', label: 'LFO 1' },
  { id: 'lfo2', label: 'LFO 2' },
  { id: 'modwheel', label: 'Mod Wheel' },
];
