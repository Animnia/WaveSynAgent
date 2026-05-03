import type { SynthState } from './types';
import { createDefaultSynthState } from './defaults';

export interface FactoryPreset {
  id: string;
  name: string;
  tags: string[];
  synthState: SynthState;
}

function basePreset(): SynthState {
  return createDefaultSynthState();
}

function warmPad(): SynthState {
  const s = basePreset();
  s.oscillators[0] = { ...s.oscillators[0], type: 'sawtooth', volume: 0.6, unison: 3, unisonSpread: 18 };
  s.oscillators[1] = { ...s.oscillators[1], enabled: true, type: 'sine', volume: 0.4, semitone: 12 };
  s.filter = { ...s.filter, type: 'lowpass', cutoff: 1800, resonance: 0.15, envelopeAmount: 0.4 };
  s.ampEnvelope = { attack: 0.8, decay: 0.6, sustain: 0.8, release: 1.6 };
  s.filterEnvelope = { attack: 0.6, decay: 0.8, sustain: 0.5, release: 1.2 };
  s.lfo1 = { ...s.lfo1, enabled: true, target: 'filterCutoff', rate: 0.4, depth: 0.25, waveform: 'sine' };
  s.effects.chorus = { enabled: true, rate: 0.6, depth: 0.5, mix: 0.4 };
  s.effects.reverb = { enabled: true, size: 0.7, damping: 0.5, mix: 0.45 };
  return s;
}

function pluckLead(): SynthState {
  const s = basePreset();
  s.oscillators[0] = { ...s.oscillators[0], type: 'square', volume: 0.7 };
  s.oscillators[1] = { ...s.oscillators[1], enabled: true, type: 'sawtooth', volume: 0.4, fine: -8 };
  s.filter = { ...s.filter, cutoff: 4500, resonance: 0.35, envelopeAmount: 0.6 };
  s.ampEnvelope = { attack: 0.005, decay: 0.18, sustain: 0.1, release: 0.2 };
  s.filterEnvelope = { attack: 0.005, decay: 0.15, sustain: 0.05, release: 0.2 };
  s.effects.delay = { enabled: true, time: 0.25, feedback: 0.35, mix: 0.25 };
  s.effects.reverb = { enabled: true, size: 0.4, damping: 0.5, mix: 0.2 };
  return s;
}

function subBass(): SynthState {
  const s = basePreset();
  s.oscillators[0] = { ...s.oscillators[0], type: 'sine', volume: 0.95, semitone: -12 };
  s.oscillators[1] = { ...s.oscillators[1], enabled: false };
  s.filter = { ...s.filter, cutoff: 600, resonance: 0.1, envelopeAmount: 0.1 };
  s.ampEnvelope = { attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.15 };
  s.effects.compressor = { enabled: true, threshold: -18, ratio: 6, attack: 0.005, release: 0.15 };
  return s;
}

function ambientTexture(): SynthState {
  const s = basePreset();
  s.oscillators[0] = { ...s.oscillators[0], type: 'triangle', volume: 0.5, unison: 5, unisonSpread: 30 };
  s.oscillators[1] = { ...s.oscillators[1], enabled: true, type: 'sine', volume: 0.4, semitone: 7, unison: 3, unisonSpread: 20 };
  s.oscillators[2] = { ...s.oscillators[2], enabled: true, type: 'sawtooth', volume: 0.25, semitone: -7 };
  s.filter = { ...s.filter, cutoff: 2200, resonance: 0.12, envelopeAmount: 0.3 };
  s.ampEnvelope = { attack: 1.6, decay: 1.0, sustain: 0.85, release: 2.5 };
  s.lfo1 = { ...s.lfo1, enabled: true, target: 'filterCutoff', rate: 0.18, depth: 0.45, waveform: 'sine' };
  s.lfo2 = { ...s.lfo2, enabled: true, target: 'pan', rate: 0.12, depth: 0.6, waveform: 'sine' };
  s.effects.chorus = { enabled: true, rate: 0.4, depth: 0.7, mix: 0.5 };
  s.effects.delay = { enabled: true, time: 0.5, feedback: 0.45, mix: 0.3 };
  s.effects.reverb = { enabled: true, size: 0.95, damping: 0.6, mix: 0.65 };
  return s;
}

function brightStab(): SynthState {
  const s = basePreset();
  s.oscillators[0] = { ...s.oscillators[0], type: 'sawtooth', volume: 0.7, unison: 3, unisonSpread: 12 };
  s.oscillators[1] = { ...s.oscillators[1], enabled: true, type: 'square', volume: 0.4, semitone: 7 };
  s.filter = { ...s.filter, cutoff: 6500, resonance: 0.4, envelopeAmount: 0.5 };
  s.ampEnvelope = { attack: 0.005, decay: 0.4, sustain: 0.0, release: 0.25 };
  s.filterEnvelope = { attack: 0.005, decay: 0.25, sustain: 0.0, release: 0.2 };
  s.effects.reverb = { enabled: true, size: 0.5, damping: 0.4, mix: 0.3 };
  return s;
}

function dirtyBass(): SynthState {
  const s = basePreset();
  s.oscillators[0] = { ...s.oscillators[0], type: 'sawtooth', volume: 0.85, semitone: -12 };
  s.oscillators[1] = { ...s.oscillators[1], enabled: true, type: 'square', volume: 0.45, semitone: -12, fine: 7 };
  s.filter = { ...s.filter, cutoff: 1200, resonance: 0.45, envelopeAmount: 0.7 };
  s.ampEnvelope = { attack: 0.005, decay: 0.25, sustain: 0.7, release: 0.18 };
  s.filterEnvelope = { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.2 };
  s.effects.distortion = { enabled: true, drive: 0.5, mix: 0.6 };
  s.effects.compressor = { enabled: true, threshold: -16, ratio: 5, attack: 0.005, release: 0.15 };
  return s;
}

export const FACTORY_PRESETS: FactoryPreset[] = [
  { id: 'factory:warm-pad', name: 'Warm Pad', tags: ['pad', 'warm'], synthState: warmPad() },
  { id: 'factory:pluck-lead', name: 'Pluck Lead', tags: ['lead', 'pluck'], synthState: pluckLead() },
  { id: 'factory:sub-bass', name: 'Sub Bass', tags: ['bass'], synthState: subBass() },
  { id: 'factory:ambient-texture', name: 'Ambient Texture', tags: ['pad', 'ambient'], synthState: ambientTexture() },
  { id: 'factory:bright-stab', name: 'Bright Stab', tags: ['stab', 'lead'], synthState: brightStab() },
  { id: 'factory:dirty-bass', name: 'Dirty Bass', tags: ['bass', 'distorted'], synthState: dirtyBass() },
];
