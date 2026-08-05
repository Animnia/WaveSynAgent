import type { ModDestination } from './types';

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
];

export const MOD_SOURCES: { id: 'lfo1' | 'lfo2'; label: string }[] = [
  { id: 'lfo1', label: 'LFO 1' },
  { id: 'lfo2', label: 'LFO 2' },
];
