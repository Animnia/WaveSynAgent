import { describe, it, expect, beforeEach, vi } from 'vitest';

// Engine needs a real AudioContext — stub it; these tests cover pattern
// state semantics only.
const engineStub = {
  start: vi.fn().mockResolvedValue(undefined),
  setSequencerPattern: vi.fn(),
  startSequencer: vi.fn(),
  stopSequencer: vi.fn(),
  onStep: null as ((step: number) => void) | null,
};

vi.mock('@/engine/AudioEngine', () => ({
  getAudioEngine: () => engineStub,
}));

import { useSequencerStore } from './sequencerStore';

beforeEach(() => {
  vi.clearAllMocks();
  useSequencerStore.setState({
    pattern: { id: 'main', name: 'Pattern 1', steps: 16, notes: [] },
    playing: false,
    currentStep: -1,
    baseNote: 60,
  });
});

describe('toggleCell', () => {
  it('adds and removes notes', () => {
    useSequencerStore.getState().toggleCell(60, 0);
    expect(useSequencerStore.getState().pattern.notes).toEqual([
      { note: 60, velocity: 100, start: 0, duration: 1 },
    ]);
    useSequencerStore.getState().toggleCell(60, 0);
    expect(useSequencerStore.getState().pattern.notes).toHaveLength(0);
  });

  it('hot-swaps the engine pattern while playing', async () => {
    await useSequencerStore.getState().play();
    engineStub.setSequencerPattern.mockClear();
    useSequencerStore.getState().toggleCell(62, 4);
    expect(engineStub.setSequencerPattern).toHaveBeenCalledOnce();
  });
});

describe('play/stop', () => {
  it('drives the engine and tracks state', async () => {
    const store = useSequencerStore.getState();
    await store.play();
    expect(engineStub.startSequencer).toHaveBeenCalledOnce();
    expect(useSequencerStore.getState().playing).toBe(true);

    // Simulate a step callback from the engine
    engineStub.onStep?.(7);
    expect(useSequencerStore.getState().currentStep).toBe(7);

    useSequencerStore.getState().stop();
    expect(engineStub.stopSequencer).toHaveBeenCalledOnce();
    expect(useSequencerStore.getState().playing).toBe(false);
    expect(useSequencerStore.getState().currentStep).toBe(-1);
    expect(engineStub.onStep).toBeNull();
  });
});

describe('setSteps', () => {
  it('drops notes beyond the new length', () => {
    useSequencerStore.getState().toggleCell(60, 20);
    useSequencerStore.setState((s) => ({
      pattern: { ...s.pattern, steps: 32, notes: [{ note: 60, velocity: 100, start: 20, duration: 1 }] },
    }));
    useSequencerStore.getState().setSteps(16);
    expect(useSequencerStore.getState().pattern.notes).toHaveLength(0);
  });
});

describe('setPatternFromAgent', () => {
  it('replaces notes and keeps identity', () => {
    useSequencerStore.getState().setPatternFromAgent({
      steps: 32,
      name: 'Agent Bassline',
      notes: [{ note: 36, start: 0, duration: 2, velocity: 110 }],
    });
    const p = useSequencerStore.getState().pattern;
    expect(p.id).toBe('main'); // identity preserved
    expect(p.name).toBe('Agent Bassline');
    expect(p.steps).toBe(32);
    expect(p.notes).toHaveLength(1);
  });

  it('resyncs the engine when playing', async () => {
    await useSequencerStore.getState().play();
    engineStub.setSequencerPattern.mockClear();
    useSequencerStore.getState().setPatternFromAgent({
      steps: 16,
      notes: [{ note: 48, start: 0, duration: 1, velocity: 100 }],
    });
    expect(engineStub.setSequencerPattern).toHaveBeenCalledOnce();
  });
});

describe('shiftOctave', () => {
  it('clamps to sensible range', () => {
    useSequencerStore.getState().shiftOctave(1);
    expect(useSequencerStore.getState().baseNote).toBe(72);
    for (let i = 0; i < 10; i++) useSequencerStore.getState().shiftOctave(1);
    expect(useSequencerStore.getState().baseNote).toBe(96);
    for (let i = 0; i < 20; i++) useSequencerStore.getState().shiftOctave(-1);
    expect(useSequencerStore.getState().baseNote).toBe(24);
  });
});
