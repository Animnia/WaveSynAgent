import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { SequencerNote, SequencerPattern, SynthState, EffectId, ModRoute } from '@/engine/types';
import { createDefaultSynthState } from '@/engine/defaults';
import { validateMutation, setByPath } from '@/engine/paramRegistry';
import { getTrackEngine, removeTrackEngine, setActiveEngineTrack } from '@/engine/registry';
import { applyMixerParams, resolveAudibility, DEFAULT_MIXER, type MixerParams } from '@/engine/mixer';
import { useSynthStore } from './synthStore';

export interface TrackSlot {
  id: string;
  name: string;
  color: string;
  synthState: SynthState;
  pattern: SequencerPattern;
  mixer: MixerParams;
  playing: boolean;
  /** Per-track undo stacks (swapped into synthStore while active). */
  past: SynthState[];
  future: SynthState[];
}

export const MAX_TRACKS = 8;

const TRACK_COLORS = [
  '#22d3ee', // cyan
  '#a78bfa', // purple
  '#f472b6', // pink
  '#fb923c', // orange
  '#4ade80', // green
  '#facc15', // yellow
  '#60a5fa', // blue
  '#f87171', // red
];

let trackCounter = 1;

function makeTrack(name: string): TrackSlot {
  const id = `track-${crypto.randomUUID().slice(0, 8)}`;
  trackCounter += 1;
  return {
    id,
    name,
    color: TRACK_COLORS[(trackCounter - 1) % TRACK_COLORS.length],
    synthState: createDefaultSynthState(),
    pattern: { id: 'main', name: 'Pattern 1', steps: 16, notes: [] },
    mixer: { ...DEFAULT_MIXER },
    playing: false,
    past: [],
    future: [],
  };
}

/** Migrate the pre-multitrack single 'sequencer' pattern into a fresh track. */
function migrateLegacyPattern(track: TrackSlot): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem('sequencer');
    if (!raw) return;
    const data = JSON.parse(raw);
    const legacy = data?.state?.pattern;
    if (legacy && Array.isArray(legacy.notes)) {
      track.pattern.steps = legacy.steps === 32 ? 32 : 16;
      track.pattern.notes = legacy.notes.filter(
        (n: SequencerNote) =>
          typeof n?.note === 'number' && typeof n?.start === 'number',
      );
    }
    localStorage.removeItem('sequencer');
  } catch {
    /* corrupted legacy data — ignore */
  }
}

interface TracksState {
  tracks: TrackSlot[];
  activeTrackId: string;
  /** Playhead step for the active track's grid (-1 = stopped). */
  currentStep: number;
  sequencerPanelOpen: boolean;
  /** MIDI note number of the grid's bottom row (C of the base octave). */
  seqBaseNote: number;
}

interface TracksActions {
  createTrack: (name?: string) => string;
  deleteTrack: (id: string) => void;
  selectTrack: (id: string) => void;
  renameTrack: (id: string, name: string) => void;
  setMixerParams: (id: string, partial: Partial<MixerParams>) => void;

  /** Path-based mutation routed to any track (agent entry point). */
  applyMutationToTrack: (trackIndex: number, path: string, value: unknown) => boolean;

  // Sequencer (pattern lives on the track)
  toggleSeqCell: (trackId: string, note: number, step: number) => void;
  clearSeqPattern: (trackId: string) => void;
  setSeqSteps: (trackId: string, steps: 16 | 32) => void;
  setSeqPattern: (trackId: string, payload: { steps: number; notes: SequencerNote[]; name?: string }) => void;
  playTrack: (trackId: string) => Promise<void>;
  stopTrack: (trackId: string) => void;
  toggleTrack: (trackId: string) => Promise<void>;

  toggleSequencerPanel: () => void;
  setSequencerPanelOpen: (open: boolean) => void;
  setCurrentStep: (step: number) => void;
  shiftSeqOctave: (direction: 1 | -1) => void;
}

function bootstrapTracks(): { tracks: TrackSlot[]; activeTrackId: string } {
  const t1 = makeTrack('Track 1');
  migrateLegacyPattern(t1);
  return { tracks: [t1], activeTrackId: t1.id };
}

const initial = bootstrapTracks();

export const useTracksStore = create<TracksState & TracksActions>()(
  persist(
    immer((set, get) => {
      /** Recompute mute/solo and apply to every channel strip. */
      const refreshMixer = () => {
        const s = get();
        const audible = resolveAudibility(
          s.tracks.map((t) => ({ id: t.id, mute: t.mixer.mute, solo: t.mixer.solo })),
        );
        for (const t of s.tracks) {
          applyMixerParams(t.id, t.mixer, audible.has(t.id));
        }
      };

      /** Hot-swap a playing track's pattern in its engine. */
      const syncPatternIfPlaying = (trackId: string) => {
        const track = get().tracks.find((t) => t.id === trackId);
        if (track?.playing) {
          getTrackEngine(trackId).setSequencerPattern(track.pattern);
        }
      };

      return {
        tracks: initial.tracks,
        activeTrackId: initial.activeTrackId,
        currentStep: -1,
        sequencerPanelOpen: false,
        seqBaseNote: 60, // C4

        createTrack: (name) => {
          if (get().tracks.length >= MAX_TRACKS) return get().activeTrackId;
          const track = makeTrack(name ?? `Track ${trackCounter}`);
          set((s) => {
            s.tracks.push(track);
          });
          refreshMixer();
          get().selectTrack(track.id);
          return track.id;
        },

        deleteTrack: (id) => {
          if (get().tracks.length <= 1) return;
          const wasActive = get().activeTrackId === id;
          set((s) => {
            s.tracks = s.tracks.filter((t) => t.id !== id);
          });
          removeTrackEngine(id);
          refreshMixer();
          if (wasActive) get().selectTrack(get().tracks[0].id);
        },

        selectTrack: (id) => {
          const s = get();
          if (id === s.activeTrackId) return;
          const next = s.tracks.find((t) => t.id === id);
          if (!next) return;

          // Write the active track's live state (incl. undo stacks) back to
          // its slot, then bind the synth store to the newly selected track.
          const synth = useSynthStore.getState();
          set((draft) => {
            const prev = draft.tracks.find((t) => t.id === draft.activeTrackId);
            if (prev) {
              prev.synthState = synth.state;
              prev.past = synth.past;
              prev.future = synth.future;
            }
          });
          setActiveEngineTrack(id);
          useSynthStore.getState().bindTrack(id, next.synthState, next.past, next.future);

          // Rebind the playhead hook to the new active engine.
          const engine = getTrackEngine(id);
          engine.onStep = next.playing
            ? (step) => get().setCurrentStep(step)
            : null;
          set((draft) => {
            draft.activeTrackId = id;
            draft.currentStep = next.playing ? draft.currentStep : -1;
          });
        },

        renameTrack: (id, name) => {
          set((s) => {
            const t = s.tracks.find((x) => x.id === id);
            if (t) t.name = name.slice(0, 24) || t.name;
          });
        },

        setMixerParams: (id, partial) => {
          set((s) => {
            const t = s.tracks.find((x) => x.id === id);
            if (t) Object.assign(t.mixer, partial);
          });
          refreshMixer();
        },

        applyMutationToTrack: (trackIndex, path, value) => {
          const s = get();
          const track = s.tracks[trackIndex];
          if (!track) return false;

          // Active track goes through synthStore (shared undo coalescing).
          if (track.id === s.activeTrackId) {
            return useSynthStore.getState().applyMutation(path, value);
          }

          // Background track: validate, snapshot into its own undo stack,
          // apply, and re-sync its engine directly.
          const parts = path.split('.');
          const applyToSlot = (t: TrackSlot): boolean => {
            if (parts[0] === 'effectChain') {
              if (!Array.isArray(value)) return false;
              t.synthState.effectChain = value as EffectId[];
              return true;
            }
            if (parts[0] === 'modulation') {
              t.synthState.modulation ??= [];
              const list = t.synthState.modulation;
              if (parts[1] === 'add' && value && typeof value === 'object') {
                list.push({
                  id: crypto.randomUUID(),
                  enabled: true,
                  source: 'lfo1',
                  destination: 'filter.cutoff',
                  depth: 0.5,
                  ...(value as Partial<ModRoute>),
                });
                return true;
              }
              if (parts[1] === 'remove' && typeof value === 'string') {
                t.synthState.modulation = list.filter((r) => r.id !== value);
                return true;
              }
              if (parts[1] === 'update' && parts[2] && value && typeof value === 'object') {
                const route = list.find((r) => r.id === parts[2]);
                if (!route) return false;
                Object.assign(route, value);
                return true;
              }
              return false;
            }
            const result = validateMutation(path, value);
            if (!result.ok) {
              console.warn(`applyMutationToTrack rejected: ${result.error}`);
              return false;
            }
            setByPath(t.synthState, path, result.value);
            return true;
          };

          let applied = false;
          set((draft) => {
            const t = draft.tracks.find((x) => x.id === track.id);
            if (!t) return;
            // Snapshot for undo (no burst coalescing for background tracks)
            t.past.push(t.synthState);
            if (t.past.length > 100) t.past.shift();
            t.future = [];
            applied = applyToSlot(t);
            if (!applied) t.past.pop(); // validation failed — drop the snapshot
          });
          if (applied) getTrackEngine(track.id).applyState(get().tracks.find((x) => x.id === track.id)!.synthState);
          return applied;
        },

        toggleSeqCell: (trackId, note, step) => {
          set((s) => {
            const t = s.tracks.find((x) => x.id === trackId);
            if (!t) return;
            const idx = t.pattern.notes.findIndex((n) => n.note === note && n.start === step);
            if (idx >= 0) t.pattern.notes.splice(idx, 1);
            else t.pattern.notes.push({ note, velocity: 100, start: step, duration: 1 });
          });
          syncPatternIfPlaying(trackId);
        },

        clearSeqPattern: (trackId) => {
          set((s) => {
            const t = s.tracks.find((x) => x.id === trackId);
            if (t) t.pattern.notes = [];
          });
          syncPatternIfPlaying(trackId);
        },

        setSeqSteps: (trackId, steps) => {
          set((s) => {
            const t = s.tracks.find((x) => x.id === trackId);
            if (!t) return;
            t.pattern.steps = steps;
            t.pattern.notes = t.pattern.notes.filter((n) => n.start < steps);
          });
          syncPatternIfPlaying(trackId);
        },

        setSeqPattern: (trackId, payload) => {
          set((s) => {
            const t = s.tracks.find((x) => x.id === trackId);
            if (!t) return;
            t.pattern.steps = payload.steps === 32 ? 32 : 16;
            t.pattern.notes = payload.notes.map((n) => ({ ...n }));
            if (payload.name) t.pattern.name = payload.name;
          });
          syncPatternIfPlaying(trackId);
        },

        playTrack: async (trackId) => {
          const track = get().tracks.find((t) => t.id === trackId);
          if (!track) return;
          const engine = getTrackEngine(trackId);
          await engine.start();
          engine.setSequencerPattern(track.pattern);
          engine.startSequencer();
          if (trackId === get().activeTrackId) {
            engine.onStep = (step) => get().setCurrentStep(step);
          }
          set((s) => {
            const t = s.tracks.find((x) => x.id === trackId);
            if (t) t.playing = true;
          });
        },

        stopTrack: (trackId) => {
          const engine = getTrackEngine(trackId);
          engine.stopSequencer();
          engine.onStep = null;
          set((s) => {
            const t = s.tracks.find((x) => x.id === trackId);
            if (t) t.playing = false;
            if (s.activeTrackId === trackId) s.currentStep = -1;
          });
        },

        toggleTrack: async (trackId) => {
          const track = get().tracks.find((t) => t.id === trackId);
          if (!track) return;
          if (track.playing) get().stopTrack(trackId);
          else await get().playTrack(trackId);
        },

        toggleSequencerPanel: () => set((s) => { s.sequencerPanelOpen = !s.sequencerPanelOpen; }),
        setSequencerPanelOpen: (open) => set((s) => { s.sequencerPanelOpen = open; }),
        setCurrentStep: (step) => set((s) => { s.currentStep = step; }),
        shiftSeqOctave: (direction) =>
          set((s) => {
            s.seqBaseNote = Math.min(96, Math.max(24, s.seqBaseNote + direction * 12));
          }),
      };
    }),
    {
      name: 'tracks',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({
        tracks: s.tracks.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          synthState: t.synthState,
          pattern: t.pattern,
          mixer: t.mixer,
        })),
        activeTrackId: s.activeTrackId,
        sequencerPanelOpen: s.sequencerPanelOpen,
        seqBaseNote: s.seqBaseNote,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<TracksState> | undefined;
        if (!p?.tracks?.length) return current;
        // Restore runtime-only fields on rehydrated slots.
        const tracks = p.tracks.map((t) => ({
          ...t,
          playing: false,
          past: t.past ?? [],
          future: t.future ?? [],
        }));
        const activeTrackId = tracks.some((t) => t.id === p.activeTrackId)
          ? p.activeTrackId!
          : tracks[0].id;
        trackCounter = Math.max(trackCounter, tracks.length);
        return { ...current, tracks, activeTrackId };
      },
    },
  ),
);

// ── Bootstrap: bind the synth store to the active track ──
// (persist hydration from localStorage is synchronous during create())
{
  const s = useTracksStore.getState();
  const slot = s.tracks.find((t) => t.id === s.activeTrackId) ?? s.tracks[0];
  setActiveEngineTrack(slot.id);
  useSynthStore.getState().bindTrack(slot.id, slot.synthState, slot.past, slot.future);
}

/** Convenience selector: the active track slot. */
export const useActiveTrack = (): TrackSlot | undefined =>
  useTracksStore((s) => s.tracks.find((t) => t.id === s.activeTrackId));
