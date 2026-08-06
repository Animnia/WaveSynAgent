import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDefaultSynthState } from '@/engine/defaults';

// The engine needs a real AudioContext — replace the registry with stubs;
// these tests cover store semantics (mutation dispatch, history), not audio.
const engineStub = {
  applyState: vi.fn(),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  panic: vi.fn(),
};

vi.mock('@/engine/registry', () => ({
  getTrackEngine: () => engineStub,
  getAudioEngine: () => engineStub,
  setActiveEngineTrack: vi.fn(),
  removeTrackEngine: vi.fn(),
}));

import { useSynthStore } from './synthStore';

function resetStore() {
  useSynthStore.setState({
    boundTrackId: 'track-1',
    state: createDefaultSynthState(),
    past: [],
    future: [],
    agentSnapshot: null,
    activeNotes: new Set<number>(),
    isPlaying: false,
  });
}

/**
 * The store's coalescing clock is module-level and persists across tests,
 * so each test gets its own monotonically increasing fake time — always
 * ahead of whatever the previous test left behind.
 */
let testNow = 1_000_000;

/** Move past the 800ms coalescing window so the next edit records history. */
function beyondCoalesceWindow() {
  testNow += 1000;
  vi.setSystemTime(testNow);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  testNow += 100_000;
  vi.setSystemTime(testNow);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('applyMutation', () => {
  it('applies a validated param mutation', () => {
    const ok = useSynthStore.getState().applyMutation('filter.cutoff', 2500);
    expect(ok).toBe(true);
    expect(useSynthStore.getState().state.filter.cutoff).toBe(2500);
  });

  it('rejects invalid values without touching state', () => {
    const before = useSynthStore.getState().state.filter.cutoff;
    const ok = useSynthStore.getState().applyMutation('filter.cutoff', 99999);
    expect(ok).toBe(false);
    expect(useSynthStore.getState().state.filter.cutoff).toBe(before);
  });

  it('handles wildcard oscillator paths', () => {
    expect(useSynthStore.getState().applyMutation('oscillators.1.volume', 0.9)).toBe(true);
    expect(useSynthStore.getState().state.oscillators[1].volume).toBe(0.9);
  });

  it('routes modulation special paths', () => {
    const s = useSynthStore.getState();
    expect(s.applyMutation('modulation.add', { source: 'lfo1', destination: 'filter.cutoff', depth: 0.4 })).toBe(true);
    const routes = useSynthStore.getState().state.modulation!;
    expect(routes).toHaveLength(1);
    expect(useSynthStore.getState().applyMutation('modulation.remove', routes[0].id)).toBe(true);
    expect(useSynthStore.getState().state.modulation).toHaveLength(0);
  });
});

describe('undo/redo', () => {
  it('undoes and redoes a parameter change', () => {
    const store = useSynthStore.getState();
    const original = store.state.filter.cutoff;

    store.applyMutation('filter.cutoff', 1000);
    expect(useSynthStore.getState().state.filter.cutoff).toBe(1000);
    expect(useSynthStore.getState().past.length).toBe(1);

    useSynthStore.getState().undo();
    expect(useSynthStore.getState().state.filter.cutoff).toBe(original);
    expect(useSynthStore.getState().future.length).toBe(1);

    useSynthStore.getState().redo();
    expect(useSynthStore.getState().state.filter.cutoff).toBe(1000);
  });

  it('coalesces a burst of edits into one history entry', () => {
    const store = useSynthStore.getState();
    store.applyMutation('filter.cutoff', 1000);
    store.applyMutation('filter.cutoff', 1100); // within 800ms window
    store.applyMutation('filter.resonance', 0.9);
    expect(useSynthStore.getState().past.length).toBe(1);

    useSynthStore.getState().undo();
    // One undo restores the pre-burst state
    expect(useSynthStore.getState().state.filter.cutoff).toBe(5000);
    expect(useSynthStore.getState().state.filter.resonance).toBe(0.2);
  });

  it('starts a new entry after the coalescing window', () => {
    const store = useSynthStore.getState();
    store.applyMutation('filter.cutoff', 1000);
    beyondCoalesceWindow();
    useSynthStore.getState().applyMutation('filter.cutoff', 2000);
    expect(useSynthStore.getState().past.length).toBe(2);
  });

  it('clears the redo stack on a new edit', () => {
    const store = useSynthStore.getState();
    store.applyMutation('filter.cutoff', 1000);
    useSynthStore.getState().undo();
    expect(useSynthStore.getState().future.length).toBe(1);
    beyondCoalesceWindow();
    useSynthStore.getState().applyMutation('filter.cutoff', 3000);
    expect(useSynthStore.getState().future.length).toBe(0);
  });

  it('undo with empty history is a no-op', () => {
    const before = useSynthStore.getState().state;
    useSynthStore.getState().undo();
    expect(useSynthStore.getState().state).toBe(before);
  });
});

describe('agent snapshot', () => {
  it('restores a taken snapshot', () => {
    const store = useSynthStore.getState();
    const original = store.state.filter.cutoff;
    store.takeSnapshot();
    useSynthStore.getState().applyMutation('filter.cutoff', 500);
    expect(useSynthStore.getState().restoreSnapshot()).toBe(true);
    expect(useSynthStore.getState().state.filter.cutoff).toBe(original);
  });

  it('restore without snapshot returns false', () => {
    expect(useSynthStore.getState().restoreSnapshot()).toBe(false);
  });

  it('a restore is itself undoable', () => {
    const store = useSynthStore.getState();
    store.takeSnapshot();
    beyondCoalesceWindow();
    useSynthStore.getState().applyMutation('filter.cutoff', 500);
    beyondCoalesceWindow();
    useSynthStore.getState().restoreSnapshot();
    useSynthStore.getState().undo();
    expect(useSynthStore.getState().state.filter.cutoff).toBe(500);
  });
});
