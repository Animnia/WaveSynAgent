/**
 * Built-in wavetables — each table is a small set of spectral frames
 * (harmonic amplitudes, sine phase). `wavetablePosition` crossfades between
 * adjacent frames, so 4 frames already give a smooth morph.
 *
 * Frames are generated programmatically at module load; harmonic counts are
 * capped, which keeps PeriodicWave synthesis inherently band-limited.
 */

export type WavetableId = 'morph' | 'formant' | 'digital' | 'soft';

export interface Wavetable {
  id: WavetableId;
  name: string;
  /** frames[frameIndex][harmonicIndex] — amplitude of harmonic (index+1). */
  frames: number[][];
}

const HARMONICS = 48;

function sineFrame(): number[] {
  const f = new Array(HARMONICS).fill(0);
  f[0] = 1;
  return f;
}

function sawFrame(n = HARMONICS): number[] {
  return Array.from({ length: n }, (_, k) => 1 / (k + 1)).concat(
    new Array(HARMONICS - n).fill(0),
  );
}

function squareFrame(n = HARMONICS): number[] {
  return Array.from({ length: HARMONICS }, (_, k) =>
    (k + 1) % 2 === 1 && k < n ? 1 / (k + 1) : 0,
  );
}

function triangleFrame(): number[] {
  return Array.from({ length: HARMONICS }, (_, k) => {
    const h = k + 1;
    if (h % 2 === 0) return 0;
    // Alternating signs per odd-harmonic pair: +1, -3, +5, -7, ...
    const sign = Math.floor((h - 1) / 2) % 2 === 0 ? 1 : -1;
    return sign / (h * h);
  });
}

/** Boost a harmonic region around `center` with width `width` (formant hump). */
function formantFrame(center: number, width: number, base = 0.06): number[] {
  return Array.from({ length: HARMONICS }, (_, k) => {
    const h = k + 1;
    const d = (h - center) / width;
    return base / h + Math.exp(-d * d);
  });
}

/** Deterministic "digital" frame — odd/even comb patterns + decay. */
function digitalFrame(seed: number): number[] {
  return Array.from({ length: HARMONICS }, (_, k) => {
    const h = k + 1;
    const comb = ((h + seed) % (2 + (seed % 3))) === 0 ? 1 : 0.25;
    const decay = 1 / Math.pow(h, 0.6 + seed * 0.15);
    return comb * decay;
  });
}

/** Soft/mellow frame — fast-decaying odd harmonics. */
function softFrame(oddEmphasis: number): number[] {
  return Array.from({ length: HARMONICS }, (_, k) => {
    const h = k + 1;
    const odd = (h % 2) === 1;
    return (odd ? oddEmphasis : 1 - oddEmphasis) / Math.pow(h, 1.6);
  });
}

export const WAVETABLES: Record<WavetableId, Wavetable> = {
  morph: {
    id: 'morph',
    name: 'Basic Morph',
    frames: [sineFrame(), triangleFrame(), sawFrame(), squareFrame()],
  },
  formant: {
    id: 'formant',
    name: 'Formant',
    frames: [
      formantFrame(3, 2.0),
      formantFrame(6, 2.5),
      formantFrame(10, 3.0),
      formantFrame(16, 4.0),
    ],
  },
  digital: {
    id: 'digital',
    name: 'Digital',
    frames: [digitalFrame(0), digitalFrame(1), digitalFrame(2), digitalFrame(3)],
  },
  soft: {
    id: 'soft',
    name: 'Soft',
    frames: [sineFrame(), softFrame(0.9), softFrame(0.7), triangleFrame()],
  },
};

export const WAVETABLE_IDS = Object.keys(WAVETABLES) as WavetableId[];

export function isWavetableId(id: unknown): id is WavetableId {
  return typeof id === 'string' && id in WAVETABLES;
}

/**
 * Resolve a morph position (0..1) to the adjacent frame pair + blend factor.
 */
export function framePair(
  table: Wavetable,
  position: number,
): { frameA: number; frameB: number; blend: number } {
  const last = table.frames.length - 1;
  const pos = Math.min(1, Math.max(0, position)) * last;
  const frameA = Math.min(last, Math.floor(pos));
  const frameB = Math.min(last, frameA + 1);
  return { frameA, frameB, blend: pos - frameA };
}
