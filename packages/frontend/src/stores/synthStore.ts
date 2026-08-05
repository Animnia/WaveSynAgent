import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { SynthState, OscillatorState, FilterState, EnvelopeState, LFOState, EffectsState, MasterState, EffectId, ModRoute } from '@/engine/types';
import { createDefaultSynthState } from '@/engine/defaults';
import { getAudioEngine } from '@/engine/AudioEngine';
import { validateMutation, setByPath } from '@/engine/paramRegistry';

interface SynthStore {
  state: SynthState;
  isPlaying: boolean;
  activeNotes: Set<number>;

  /** Undo history (immutable snapshots — immer COW makes sharing safe). */
  past: SynthState[];
  future: SynthState[];
  /** Restore point saved by the AI agent (snapshot_patch tool). */
  agentSnapshot: SynthState | null;

  // Actions
  setSynthState: (state: SynthState) => void;
  /**
   * Generic registry-driven mutation entry point (used by the AI agent and
   * any path-based caller). Validates against paramSpecs; special paths:
   *   effectChain                 → reorderEffectChain(value: EffectId[])
   *   modulation.add              → addModRoute(value)
   *   modulation.remove           → removeModRoute(value: id)
   *   modulation.update.<id>      → updateModRoute(id, value)
   * Returns true when the mutation was applied.
   */
  applyMutation: (path: string, value: unknown) => boolean;
  undo: () => void;
  redo: () => void;
  takeSnapshot: () => void;
  /** Restore the agent snapshot. Returns false when none exists. */
  restoreSnapshot: () => boolean;
  updateOscillator: (index: number, partial: Partial<OscillatorState>) => void;
  updateFilter: (partial: Partial<FilterState>) => void;
  updateAmpEnvelope: (partial: Partial<EnvelopeState>) => void;
  updateFilterEnvelope: (partial: Partial<EnvelopeState>) => void;
  updateLFO: (index: 1 | 2, partial: Partial<LFOState>) => void;
  updateEffects: (partial: Partial<EffectsState>) => void;
  reorderEffectChain: (newOrder: EffectId[]) => void;
  addModRoute: (route?: Partial<ModRoute>) => void;
  updateModRoute: (id: string, partial: Partial<ModRoute>) => void;
  removeModRoute: (id: string) => void;
  updateMaster: (partial: Partial<MasterState>) => void;
  noteOn: (midiNote: number, velocity?: number) => void;
  noteOff: (midiNote: number) => void;
  panic: () => void;
}

/** Edits closer than this are coalesced into a single history entry
 *  (knob drags, agent bursts). */
const HISTORY_COALESCE_MS = 800;
const HISTORY_LIMIT = 100;
/** Module-level coalescing clock (not UI state, doesn't belong in the store). */
let lastEditAt = 0;

export const useSynthStore = create<SynthStore>()(
  immer((set, get) => {
    const syncEngine = () => {
      const engine = getAudioEngine();
      engine.applyState(get().state);
    };

    /**
     * Push the current state onto the undo stack. Snapshots are shared by
     * reference — immer never mutates frozen base states, so this is O(1).
     */
    const recordHistory = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEditAt <= HISTORY_COALESCE_MS) {
        lastEditAt = now;
        return;
      }
      lastEditAt = now;
      const current = get().state;
      set((draft) => {
        draft.past.push(current);
        if (draft.past.length > HISTORY_LIMIT) draft.past.shift();
        draft.future = [];
      });
    };

    return {
      state: createDefaultSynthState(),
      isPlaying: false,
      activeNotes: new Set<number>(),
      past: [],
      future: [],
      agentSnapshot: null,

      setSynthState: (newState) => {
        recordHistory(true); // discrete wholesale change (e.g. preset load)
        set((draft) => {
          draft.state = newState;
        });
        syncEngine();
      },

      undo: () => {
        const { past, state } = get();
        if (past.length === 0) return;
        const previous = past[past.length - 1];
        lastEditAt = 0; // next edit starts a fresh history entry
        set((draft) => {
          draft.past.pop();
          draft.future.push(state);
          draft.state = previous;
        });
        syncEngine();
      },

      redo: () => {
        const { future, state } = get();
        if (future.length === 0) return;
        const next = future[future.length - 1];
        lastEditAt = 0;
        set((draft) => {
          draft.future.pop();
          draft.past.push(state);
          draft.state = next;
        });
        syncEngine();
      },

      takeSnapshot: () => {
        const current = get().state;
        set((draft) => {
          draft.agentSnapshot = current;
        });
      },

      restoreSnapshot: () => {
        const snap = get().agentSnapshot;
        if (!snap) return false;
        recordHistory(true); // the restore itself is undoable
        set((draft) => {
          draft.state = snap;
        });
        syncEngine();
        return true;
      },

      applyMutation: (path, value) => {
        const parts = path.split('.');

        // ── Special (non-registry) paths ──
        if (parts[0] === 'effectChain') {
          if (!Array.isArray(value)) {
            console.warn('applyMutation: effectChain expects an array, got', value);
            return false;
          }
          get().reorderEffectChain(value as EffectId[]);
          return true;
        }
        if (parts[0] === 'modulation') {
          if (parts[1] === 'add') {
            get().addModRoute(value as Partial<ModRoute>);
            return true;
          }
          if (parts[1] === 'remove' && typeof value === 'string') {
            get().removeModRoute(value);
            return true;
          }
          if (parts[1] === 'update' && parts[2] && value && typeof value === 'object') {
            get().updateModRoute(parts[2], value as Partial<ModRoute>);
            return true;
          }
          console.warn('applyMutation: malformed modulation mutation', path, value);
          return false;
        }

        // ── Registry-validated parameter paths ──
        const result = validateMutation(path, value);
        if (!result.ok) {
          console.warn(`applyMutation rejected: ${result.error}`);
          return false;
        }
        recordHistory();
        set((draft) => {
          setByPath(draft.state, path, result.value);
        });
        syncEngine();
        return true;
      },

      updateOscillator: (index, partial) => {
        recordHistory();
        set((draft) => {
          Object.assign(draft.state.oscillators[index], partial);
        });
        syncEngine();
      },

      updateFilter: (partial) => {
        recordHistory();
        set((draft) => {
          Object.assign(draft.state.filter, partial);
        });
        syncEngine();
      },

      updateAmpEnvelope: (partial) => {
        recordHistory();
        set((draft) => {
          Object.assign(draft.state.ampEnvelope, partial);
        });
        syncEngine();
      },

      updateFilterEnvelope: (partial) => {
        recordHistory();
        set((draft) => {
          Object.assign(draft.state.filterEnvelope, partial);
        });
        syncEngine();
      },

      updateLFO: (index, partial) => {
        recordHistory();
        set((draft) => {
          const key = index === 1 ? 'lfo1' : 'lfo2';
          Object.assign(draft.state[key], partial);
        });
        syncEngine();
      },

      updateEffects: (partial) => {
        recordHistory();
        set((draft) => {
          // Deep merge for nested effect objects
          for (const [key, value] of Object.entries(partial)) {
            if (key in draft.state.effects) {
              Object.assign(
                draft.state.effects[key as keyof EffectsState],
                value,
              );
            }
          }
        });
        syncEngine();
      },

      reorderEffectChain: (newOrder) => {
        recordHistory();
        set((draft) => {
          draft.state.effectChain = newOrder;
        });
        syncEngine();
      },

      addModRoute: (partial) => {
        recordHistory();
        set((draft) => {
          if (!draft.state.modulation) draft.state.modulation = [];
          const id =
            (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
              ? crypto.randomUUID()
              : `mod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          draft.state.modulation.push({
            id,
            enabled: true,
            source: partial?.source ?? 'lfo1',
            destination: partial?.destination ?? 'filter.cutoff',
            depth: partial?.depth ?? 0.5,
          });
        });
        syncEngine();
      },

      updateModRoute: (id, partial) => {
        recordHistory();
        set((draft) => {
          const list = draft.state.modulation;
          if (!list) return;
          const route = list.find((r) => r.id === id);
          if (route) Object.assign(route, partial);
        });
        syncEngine();
      },

      removeModRoute: (id) => {
        recordHistory();
        set((draft) => {
          if (!draft.state.modulation) return;
          draft.state.modulation = draft.state.modulation.filter((r) => r.id !== id);
        });
        syncEngine();
      },

      updateMaster: (partial) => {
        recordHistory();
        set((draft) => {
          Object.assign(draft.state.master, partial);
        });
        syncEngine();
      },

      noteOn: (midiNote, velocity = 100) => {
        const engine = getAudioEngine();
        engine.noteOn(midiNote, velocity);
        set((draft) => {
          draft.activeNotes.add(midiNote);
        });
      },

      noteOff: (midiNote) => {
        const engine = getAudioEngine();
        engine.noteOff(midiNote);
        set((draft) => {
          draft.activeNotes.delete(midiNote);
        });
      },

      panic: () => {
        const engine = getAudioEngine();
        engine.panic();
        set((draft) => {
          draft.activeNotes.clear();
        });
      },
    };
  }),
);
