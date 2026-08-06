import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDefaultSynthState } from '@/engine/defaults';

// Engine + mixer need a real AudioContext — stub the registry/mixer layer.
// vi.hoisted: tracksStore's module-level bootstrap calls getTrackEngine
// during import, before top-level consts would be initialized.
const { engineStub } = vi.hoisted(() => {
  const engineStub = {
    applyState: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    panic: vi.fn(),
    setSequencerPattern: vi.fn(),
    startSequencer: vi.fn(),
    stopSequencer: vi.fn(),
    onStep: null as ((step: number) => void) | null,
  };
  return { engineStub };
});

vi.mock('@/engine/registry', () => ({
  getTrackEngine: () => engineStub,
  getAudioEngine: () => engineStub,
  setActiveEngineTrack: vi.fn(),
  removeTrackEngine: vi.fn(),
}));

vi.mock('@/engine/mixer', () => ({
  applyMixerParams: vi.fn(),
  resolveAudibility: (tracks: { id: string; mute: boolean; solo: boolean }[]) => {
    const anySolo = tracks.some((t) => t.solo);
    return new Set(tracks.filter((t) => (anySolo ? t.solo : !t.mute)).map((t) => t.id));
  },
  DEFAULT_MIXER: { volume: 0.8, pan: 0, mute: false, solo: false },
}));

import { useTracksStore, MAX_TRACKS } from './tracksStore';
import { useSynthStore } from './synthStore';
import { resolveAudibility } from '@/engine/mixer';

function freshTrack(id: string, name: string) {
  return {
    id,
    name,
    color: '#fff',
    synthState: createDefaultSynthState(),
    pattern: { id: 'main', name: 'Pattern 1', steps: 16 as const, notes: [] },
    mixer: { volume: 0.8, pan: 0, mute: false, solo: false },
    enabled: true,
    playing: false,
    past: [],
    future: [],
  };
}

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
});

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  useTracksStore.setState({
    tracks: [freshTrack('t1', 'Track 1'), freshTrack('t2', 'Track 2')],
    activeTrackId: 't1',
    currentStep: -1,
    sequencerPanelOpen: false,
    seqBaseNote: 60,
  });
  useSynthStore.setState({
    boundTrackId: 't1',
    state: createDefaultSynthState(),
    past: [],
    future: [],
    agentSnapshot: null,
    activeNotes: new Set<number>(),
    isPlaying: false,
  });
});

describe('track management', () => {
  it('creates and selects a new track', () => {
    const id = useTracksStore.getState().createTrack('Bass');
    const s = useTracksStore.getState();
    expect(s.tracks).toHaveLength(3);
    expect(s.activeTrackId).toBe(id);
    expect(s.tracks[2].name).toBe('Bass');
    // synthStore got bound to the new track
    expect(useSynthStore.getState().boundTrackId).toBe(id);
  });

  it('caps tracks at MAX_TRACKS', () => {
    useTracksStore.setState(() => ({
      tracks: Array.from({ length: MAX_TRACKS }, (_, i) => freshTrack(`x${i}`, `T${i}`)),
    }));
    const before = useTracksStore.getState().tracks.length;
    useTracksStore.getState().createTrack();
    expect(useTracksStore.getState().tracks.length).toBe(before);
  });

  it('deletes a track and reselects when it was active', () => {
    useTracksStore.getState().deleteTrack('t1');
    const s = useTracksStore.getState();
    expect(s.tracks).toHaveLength(1);
    expect(s.activeTrackId).toBe('t2');
    expect(useSynthStore.getState().boundTrackId).toBe('t2');
  });

  it('never deletes the last track', () => {
    useTracksStore.getState().deleteTrack('t2');
    useTracksStore.getState().deleteTrack('t1');
    expect(useTracksStore.getState().tracks).toHaveLength(1);
  });
});

describe('track switching preserves per-track state + undo stacks', () => {
  it('writes back on switch and restores on switch-back', () => {
    // Edit track 1 via the bound synthStore
    useSynthStore.getState().applyMutation('filter.cutoff', 1234);
    expect(useSynthStore.getState().past.length).toBe(1);

    // Switch to track 2 — sees ITS state
    useTracksStore.getState().selectTrack('t2');
    expect(useSynthStore.getState().state.filter.cutoff).toBe(5000);
    expect(useSynthStore.getState().past).toHaveLength(0);

    // Edit track 2, then switch back — track 1's state + history restored
    useSynthStore.getState().applyMutation('filter.cutoff', 900);
    useTracksStore.getState().selectTrack('t1');
    expect(useSynthStore.getState().state.filter.cutoff).toBe(1234);
    expect(useSynthStore.getState().past.length).toBe(1);

    // Track 2 kept its own edit
    const t2 = useTracksStore.getState().tracks.find((t) => t.id === 't2')!;
    expect(t2.synthState.filter.cutoff).toBe(900);
  });
});

describe('applyMutationToTrack', () => {
  it('routes to the active track via synthStore', () => {
    const ok = useTracksStore.getState().applyMutationToTrack(0, 'filter.cutoff', 2000);
    expect(ok).toBe(true);
    expect(useSynthStore.getState().state.filter.cutoff).toBe(2000);
  });

  it('mutates a background track directly and syncs its engine', () => {
    const ok = useTracksStore.getState().applyMutationToTrack(1, 'filter.cutoff', 3000);
    expect(ok).toBe(true);
    const t2 = useTracksStore.getState().tracks[1];
    expect(t2.synthState.filter.cutoff).toBe(3000);
    expect(engineStub.applyState).toHaveBeenCalled();
    // background track got its own undo entry
    expect(t2.past.length).toBe(1);
  });

  it('rejects invalid values and out-of-range track indexes', () => {
    expect(useTracksStore.getState().applyMutationToTrack(1, 'filter.cutoff', 99999)).toBe(false);
    expect(useTracksStore.getState().applyMutationToTrack(9, 'filter.cutoff', 1000)).toBe(false);
    expect(useTracksStore.getState().tracks[1].synthState.filter.cutoff).toBe(5000);
  });
});

describe('track enable/disable', () => {
  it('toggleTrackEnabled flips the power flag', () => {
    useTracksStore.getState().toggleTrackEnabled('t2');
    expect(useTracksStore.getState().tracks[1].enabled).toBe(false);
    useTracksStore.getState().toggleTrackEnabled('t2');
    expect(useTracksStore.getState().tracks[1].enabled).toBe(true);
  });

  it('a disabled track cannot play', async () => {
    useTracksStore.getState().toggleTrackEnabled('t1');
    await useTracksStore.getState().playTrack('t1');
    expect(engineStub.startSequencer).not.toHaveBeenCalled();
    expect(useTracksStore.getState().tracks[0].playing).toBe(false);
  });

  it('disabling a playing track stops it', async () => {
    await useTracksStore.getState().playTrack('t1');
    expect(useTracksStore.getState().tracks[0].playing).toBe(true);
    useTracksStore.getState().toggleTrackEnabled('t1');
    expect(engineStub.stopSequencer).toHaveBeenCalledOnce();
    expect(useTracksStore.getState().tracks[0].playing).toBe(false);
  });
});

describe('mixer', () => {
  it('resolveAudibility: mute and solo semantics', () => {
    const tracks = [
      { id: 'a', mute: false, solo: false },
      { id: 'b', mute: true, solo: false },
      { id: 'c', mute: false, solo: false },
    ];
    expect([...resolveAudibility(tracks)]).toEqual(['a', 'c']);

    tracks[0].solo = true;
    expect([...resolveAudibility(tracks)]).toEqual(['a']);
  });

  it('setMixerParams updates the slot and reapplies', () => {
    useTracksStore.getState().setMixerParams('t2', { volume: 0.4, solo: true });
    const t2 = useTracksStore.getState().tracks[1];
    expect(t2.mixer.volume).toBe(0.4);
    expect(t2.mixer.solo).toBe(true);
  });
});

describe('sequencer on tracks', () => {
  it('toggleSeqCell adds/removes and hot-syncs when playing', async () => {
    useTracksStore.getState().toggleSeqCell('t1', 60, 0);
    expect(useTracksStore.getState().tracks[0].pattern.notes).toHaveLength(1);
    expect(engineStub.setSequencerPattern).not.toHaveBeenCalled();

    await useTracksStore.getState().playTrack('t1');
    engineStub.setSequencerPattern.mockClear();
    useTracksStore.getState().toggleSeqCell('t1', 60, 0); // remove
    expect(useTracksStore.getState().tracks[0].pattern.notes).toHaveLength(0);
    expect(engineStub.setSequencerPattern).toHaveBeenCalledOnce();
  });

  it('play/stop update flags and engine', async () => {
    await useTracksStore.getState().playTrack('t2');
    expect(engineStub.startSequencer).toHaveBeenCalledOnce();
    expect(useTracksStore.getState().tracks[1].playing).toBe(true);

    useTracksStore.getState().stopTrack('t2');
    expect(engineStub.stopSequencer).toHaveBeenCalledOnce();
    expect(useTracksStore.getState().tracks[1].playing).toBe(false);
  });

  it('setSeqPattern (agent) replaces notes, keeps identity', () => {
    useTracksStore.getState().setSeqPattern('t2', {
      steps: 32,
      name: 'Agent riff',
      notes: [{ note: 36, start: 0, duration: 1, velocity: 100 }],
    });
    const p = useTracksStore.getState().tracks[1].pattern;
    expect(p.steps).toBe(32);
    expect(p.name).toBe('Agent riff');
    expect(p.notes).toHaveLength(1);
  });
});
