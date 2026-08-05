import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { SequencerNote, SequencerPattern } from '@/engine/types';
import { getAudioEngine } from '@/engine/AudioEngine';

/** Pattern payload accepted from the agent (no id/name — those are kept). */
export interface AgentPatternPayload {
  steps: number;
  notes: SequencerNote[];
  name?: string;
}

interface SequencerState {
  pattern: SequencerPattern;
  playing: boolean;
  /** Current step for UI highlight, -1 when stopped. */
  currentStep: number;
  panelOpen: boolean;
  /** MIDI note number of the grid's bottom row (C of the base octave). */
  baseNote: number;
}

interface SequencerActions {
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  play: () => Promise<void>;
  stop: () => void;
  toggle: () => Promise<void>;
  toggleCell: (note: number, step: number) => void;
  clearPattern: () => void;
  setSteps: (steps: 16 | 32) => void;
  shiftOctave: (direction: 1 | -1) => void;
  setPatternFromAgent: (payload: AgentPatternPayload) => void;
}

function emptyPattern(): SequencerPattern {
  return { id: 'main', name: 'Pattern 1', steps: 16, notes: [] };
}

/** Re-sync the engine's part (resumes seamlessly when already playing). */
function syncEnginePattern(pattern: SequencerPattern): void {
  getAudioEngine().setSequencerPattern(pattern);
}

export const useSequencerStore = create<SequencerState & SequencerActions>()(
  persist(
    immer((set, get) => ({
      pattern: emptyPattern(),
      playing: false,
      currentStep: -1,
      panelOpen: false,
      baseNote: 60, // C4

      togglePanel: () => set((s) => { s.panelOpen = !s.panelOpen; }),
      setPanelOpen: (open) => set((s) => { s.panelOpen = open; }),

      play: async () => {
        const engine = getAudioEngine();
        await engine.start();
        engine.onStep = (step) => {
          set((s) => { s.currentStep = step; });
        };
        engine.setSequencerPattern(get().pattern);
        engine.startSequencer();
        set((s) => { s.playing = true; });
      },

      stop: () => {
        const engine = getAudioEngine();
        engine.stopSequencer();
        engine.onStep = null;
        set((s) => {
          s.playing = false;
          s.currentStep = -1;
        });
      },

      toggle: async () => {
        if (get().playing) get().stop();
        else await get().play();
      },

      toggleCell: (note, step) => {
        set((s) => {
          const idx = s.pattern.notes.findIndex((n) => n.note === note && n.start === step);
          if (idx >= 0) s.pattern.notes.splice(idx, 1);
          else s.pattern.notes.push({ note, velocity: 100, start: step, duration: 1 });
        });
        if (get().playing) syncEnginePattern(get().pattern);
      },

      clearPattern: () => {
        set((s) => { s.pattern.notes = []; });
        if (get().playing) syncEnginePattern(get().pattern);
      },

      setSteps: (steps) => {
        set((s) => {
          s.pattern.steps = steps;
          // Drop notes beyond the new length
          s.pattern.notes = s.pattern.notes.filter((n) => n.start < steps);
        });
        if (get().playing) syncEnginePattern(get().pattern);
      },

      shiftOctave: (direction) => {
        set((s) => {
          s.baseNote = Math.min(96, Math.max(24, s.baseNote + direction * 12));
        });
      },

      setPatternFromAgent: (payload) => {
        set((s) => {
          s.pattern.steps = payload.steps === 32 ? 32 : 16;
          s.pattern.notes = payload.notes.map((n) => ({ ...n }));
          if (payload.name) s.pattern.name = payload.name;
        });
        // If currently playing, hot-swap; otherwise just leave it ready.
        if (get().playing) syncEnginePattern(get().pattern);
      },
    })),
    {
      name: 'sequencer',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ pattern: s.pattern, panelOpen: s.panelOpen, baseNote: s.baseNote }),
    },
  ),
);
