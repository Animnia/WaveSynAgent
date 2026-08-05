/**
 * Audio feature extraction — the agent's ears.
 *
 * Samples the engine's analysers over a capture window while notes ring and
 * condenses them into a small feature object the LLM can reason about
 * (loudness, clipping, brightness, band balance). All values are computed
 * client-side; the agent-server only sees the resulting JSON.
 */
import * as Tone from 'tone';
import type { AudioEngine } from './AudioEngine';

export interface AudioFeatures {
  /** Average loudness over the window, dBFS (-80 ≈ silent). */
  rms_db: number;
  /** Highest sample peak over the window, dBFS. */
  peak_db: number;
  /** True when the peak hit ~full scale (audible clipping risk). */
  clipping: boolean;
  /** Magnitude-weighted spectral centroid in Hz (brightness). Null if silent. */
  spectral_centroid_hz: number | null;
  /** Mean band levels in dB. */
  band_db: { sub: number; low_mid: number; presence: number; air: number };
  silent: boolean;
  frames: number;
  duration_ms: number;
}

const FFT_SIZE = 2048;
const FRAME_INTERVAL_MS = 40;

// Band edges in Hz: sub rumble / body / presence / air
const BANDS = [
  { key: 'sub', lo: 20, hi: 120 },
  { key: 'low_mid', lo: 120, hi: 800 },
  { key: 'presence', lo: 800, hi: 4000 },
  { key: 'air', lo: 4000, hi: 16000 },
] as const;

function toDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-8));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Capture features over `durationMs`. Call right after triggering notes so
 * the window covers the attack + sustain of the sound.
 */
export async function captureAudioFeatures(
  engine: AudioEngine,
  durationMs: number,
): Promise<AudioFeatures> {
  const sampleRate = Tone.getContext().sampleRate;
  const binHz = sampleRate / FFT_SIZE;
  const frameCount = Math.max(4, Math.round(durationMs / FRAME_INTERVAL_MS));

  let rmsAcc = 0;
  let peak = 0;
  let centroidMagSum = 0;
  let centroidFreqMagSum = 0;
  const bandDbSum: Record<string, number> = { sub: 0, low_mid: 0, presence: 0, air: 0 };

  for (let i = 0; i < frameCount; i++) {
    const wave = engine.getWaveformData();
    const fft = engine.getFFTData();

    // ── Time domain ──
    let squareSum = 0;
    for (let j = 0; j < wave.length; j++) {
      const v = wave[j];
      squareSum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    rmsAcc += Math.sqrt(squareSum / wave.length);

    // ── Frequency domain (values are dB per bin) ──
    for (const band of BANDS) {
      const fromBin = Math.max(1, Math.floor(band.lo / binHz));
      const toBin = Math.min(fft.length - 1, Math.ceil(band.hi / binHz));
      let acc = 0;
      let n = 0;
      for (let b = fromBin; b <= toBin; b++) {
        acc += fft[b];
        n++;
      }
      bandDbSum[band.key] += n > 0 ? acc / n : -100;
    }

    for (let b = 1; b < fft.length; b++) {
      const mag = Math.pow(10, fft[b] / 20);
      centroidMagSum += mag;
      centroidFreqMagSum += mag * b * binHz;
    }

    if (i < frameCount - 1) await sleep(FRAME_INTERVAL_MS);
  }

  const rms = rmsAcc / frameCount;
  const silent = rms < 1e-4;

  return {
    rms_db: Math.round(toDb(rms) * 10) / 10,
    peak_db: Math.round(toDb(peak) * 10) / 10,
    clipping: peak >= 0.98,
    spectral_centroid_hz:
      !silent && centroidMagSum > 0
        ? Math.round(centroidFreqMagSum / centroidMagSum)
        : null,
    band_db: {
      sub: Math.round((bandDbSum.sub / frameCount) * 10) / 10,
      low_mid: Math.round((bandDbSum.low_mid / frameCount) * 10) / 10,
      presence: Math.round((bandDbSum.presence / frameCount) * 10) / 10,
      air: Math.round((bandDbSum.air / frameCount) * 10) / 10,
    },
    silent,
    frames: frameCount,
    duration_ms: durationMs,
  };
}
