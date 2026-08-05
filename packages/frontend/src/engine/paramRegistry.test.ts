import { describe, it, expect } from 'vitest';
import { matchSpec, validateMutation, setByPath, PARAM_SPECS } from './paramRegistry';

describe('matchSpec', () => {
  it('matches exact paths', () => {
    expect(matchSpec('filter.cutoff')).toBeDefined();
    expect(matchSpec('master.bpm')).toBeDefined();
  });

  it('matches wildcard oscillator paths', () => {
    expect(matchSpec('oscillators.0.volume')?.label).toBe('OSC volume');
    expect(matchSpec('oscillators.2.unison')).toBeDefined();
  });

  it('rejects wrong segment counts and unknown paths', () => {
    expect(matchSpec('oscillators.volume')).toBeUndefined();
    expect(matchSpec('oscillators.0.volume.extra')).toBeUndefined();
    expect(matchSpec('nope.nope')).toBeUndefined();
  });
});

describe('validateMutation', () => {
  it('accepts in-range numbers', () => {
    const r = validateMutation('filter.cutoff', 2500);
    expect(r).toEqual({ ok: true, value: 2500 });
  });

  it('rejects out-of-range numbers with a helpful message', () => {
    const r = validateMutation('filter.cutoff', 99999);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('20000');
  });

  it('rounds integers', () => {
    expect(validateMutation('master.bpm', 128.4)).toEqual({ ok: true, value: 128 });
  });

  it('validates enums strictly', () => {
    expect(validateMutation('filter.type', 'bandpass').ok).toBe(true);
    expect(validateMutation('filter.type', 'banana').ok).toBe(false);
  });

  it('validates booleans strictly (no truthy coercion)', () => {
    expect(validateMutation('lfo1.enabled', true).ok).toBe(true);
    expect(validateMutation('lfo1.enabled', 'true').ok).toBe(false);
  });

  it('coerces numeric strings', () => {
    expect(validateMutation('oscillators.0.volume', '0.5')).toEqual({ ok: true, value: 0.5 });
  });

  it('blocks prototype pollution segments', () => {
    for (const seg of ['__proto__', 'constructor', 'prototype']) {
      const r = validateMutation(`oscillators.0.${seg}`, {});
      expect(r.ok).toBe(false);
    }
  });
});

describe('setByPath', () => {
  it('sets nested object and array paths', () => {
    const obj = { oscillators: [{ volume: 0.5 }], filter: { cutoff: 1000 } };
    setByPath(obj, 'oscillators.0.volume', 0.8);
    setByPath(obj, 'filter.cutoff', 3000);
    expect(obj.oscillators[0].volume).toBe(0.8);
    expect(obj.filter.cutoff).toBe(3000);
  });
});

describe('spec integrity', () => {
  it('has no duplicate paths and sane ranges', () => {
    const paths = PARAM_SPECS.map((s) => s.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const s of PARAM_SPECS) {
      if (s.type === 'number' || s.type === 'integer') {
        expect(s.min).toBeDefined();
        expect(s.max).toBeDefined();
        expect(s.min!).toBeLessThan(s.max!);
      }
      if (s.type === 'enum') expect(s.values?.length).toBeGreaterThan(0);
    }
  });
});
