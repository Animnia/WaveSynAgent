import { describe, it, expect } from 'vitest';
import { WAVETABLES, WAVETABLE_IDS, framePair, isWavetableId } from './wavetables';
import { normalizeSynthState, createDefaultSynthState } from './defaults';

describe('wavetables', () => {
  it('every table has 4 well-formed frames', () => {
    for (const id of WAVETABLE_IDS) {
      const table = WAVETABLES[id];
      expect(table.frames).toHaveLength(4);
      for (const frame of table.frames) {
        expect(frame.length).toBeGreaterThanOrEqual(48);
        expect(frame[0]).toBeGreaterThan(0); // fundamental always present
        expect(frame.every((v) => Number.isFinite(v))).toBe(true);
      }
    }
  });

  it('framePair maps positions to adjacent frames', () => {
    const t = WAVETABLES.morph;
    expect(framePair(t, 0)).toEqual({ frameA: 0, frameB: 1, blend: 0 });
    expect(framePair(t, 1)).toEqual({ frameA: 3, frameB: 3, blend: 0 });
    const mid = framePair(t, 0.5); // 0.5 * 3 = 1.5 → frames 1/2, blend 0.5
    expect(mid.frameA).toBe(1);
    expect(mid.frameB).toBe(2);
    expect(mid.blend).toBeCloseTo(0.5);
  });

  it('clamps out-of-range positions', () => {
    const t = WAVETABLES.morph;
    expect(framePair(t, -0.5)).toEqual({ frameA: 0, frameB: 1, blend: 0 });
    expect(framePair(t, 2).frameA).toBe(3);
  });

  it('isWavetableId guards ids', () => {
    expect(isWavetableId('morph')).toBe(true);
    expect(isWavetableId('banana')).toBe(false);
  });
});

describe('normalizeSynthState', () => {
  it('passes through a full current state unchanged', () => {
    const s = createDefaultSynthState();
    s.filter.cutoff = 1234;
    const n = normalizeSynthState(JSON.parse(JSON.stringify(s)));
    expect(n.filter.cutoff).toBe(1234);
    expect(n.oscillators[0].wavetable).toBe('morph');
  });

  it('fills missing fields for legacy presets (pre-wavetable era)', () => {
    const legacy = createDefaultSynthState() as unknown as Record<string, unknown>;
    // Simulate a preset saved before wavetable fields existed
    for (const osc of legacy.oscillators as Record<string, unknown>[]) {
      delete osc.wavetable;
      delete osc.wavetablePosition;
    }
    delete legacy.modulation;
    delete legacy.effectChain;

    const n = normalizeSynthState(legacy);
    expect(n.oscillators[0].wavetable).toBe('morph');
    expect(n.oscillators[0].wavetablePosition).toBe(0);
    expect(n.modulation).toEqual([]);
    expect(n.effectChain).toHaveLength(9);
  });

  it('keeps user values while filling gaps', () => {
    const partial = {
      oscillators: [{ volume: 0.33 }],
      filter: { cutoff: 900 },
    };
    const n = normalizeSynthState(partial);
    expect(n.oscillators[0].volume).toBe(0.33);
    expect(n.oscillators[0].type).toBe('sawtooth'); // default filled
    expect(n.filter.cutoff).toBe(900);
    expect(n.filter.type).toBe('lowpass');
  });

  it('returns defaults for garbage input', () => {
    expect(normalizeSynthState(null)).toEqual(createDefaultSynthState());
    expect(normalizeSynthState('nonsense')).toEqual(createDefaultSynthState());
  });
});
