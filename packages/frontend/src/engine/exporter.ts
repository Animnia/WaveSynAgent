/**
 * WAV export — renders the current track(s) offline (faster than real time)
 * and encodes 16-bit PCM WAV.
 *
 * Throwaway AudioEngine instances are constructed INSIDE Tone.Offline's
 * callback, so every node binds to the OfflineAudioContext; the live engines
 * are untouched (Tone.Offline restores the global context before rendering).
 * All engines created in the callback share the offline Transport, so
 * multi-track patterns render in perfect sync.
 */
import * as Tone from 'tone';
import { AudioEngine } from './AudioEngine';
import { resolveAudibility, type MixerParams } from './mixer';
import type { SequencerPattern, SynthState } from './types';

export interface ExportRequest {
  /** Loop the current sequencer pattern for this many bars (when a pattern exists). */
  bars?: number;
  /** Total seconds for the chord-demo render (when no pattern exists). */
  duration?: number;
  /** Chord to demo when there is no sequencer pattern. */
  notes?: number[];
}

/** A track's renderable slice. */
export interface ExportTrack {
  synthState: SynthState;
  pattern: SequencerPattern;
  mixer: MixerParams;
}

interface RenderableBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/** Encode an AudioBuffer(-shaped) object as 16-bit PCM stereo WAV. */
export function audioBufferToWav(buffer: RenderableBuffer): Blob {
  const channels = 2; // always stereo; mono input is duplicated
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;

  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of [ch0, ch1]) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

/**
 * Render the mix of all audible tracks (mute/solo honored). Patterns loop
 * for `bars` bars plus a 1s tail; when no track has a pattern, a demo chord
 * plays through the first audible track. Returns a WAV blob.
 */
export async function renderMixToWav(
  tracks: ExportTrack[],
  request: ExportRequest = {},
): Promise<Blob> {
  const audible = resolveAudibility(
    tracks.map((t, i) => ({ id: String(i), mute: t.mixer.mute, solo: t.mixer.solo })),
  );
  const active = tracks.filter((_, i) => audible.has(String(i)));
  if (active.length === 0) {
    throw new Error('没有可导出的音轨（全部被静音）');
  }

  // Global BPM: the shared Transport has one clock — use the first audible
  // track's bpm (the tracks' master.bpm are last-writer-wins live, too).
  const bpm = active[0].synthState.master.bpm || 120;
  const secPerBar = (60 / bpm) * 4;

  const anyPattern = active.some((t) => t.pattern.notes.length > 0);
  let duration: number;
  if (anyPattern) {
    const bars = Math.min(8, Math.max(1, Math.round(request.bars ?? 2)));
    const maxLoopBars = Math.max(
      ...active.map((t) => (t.pattern.notes.length > 0 ? t.pattern.steps / 16 : 0)),
      1,
    );
    duration = maxLoopBars * bars * secPerBar + 1.0;
  } else {
    duration = Math.min(30, Math.max(0.5, request.duration ?? 3));
  }

  const toneBuffer = await Tone.Offline(async () => {
    const master = new Tone.Gain(0.8);
    master.toDestination();

    let chordPlayed = false;
    for (const track of active) {
      const engine = new AudioEngine();
      engine.markOffline();
      engine.applyState(track.synthState);

      // Channel strip: volume + pan
      const gain = new Tone.Gain(track.mixer.volume);
      const panner = new Tone.Panner(track.mixer.pan);
      engine.output.connect(gain);
      gain.connect(panner);
      panner.connect(master);

      if (track.pattern.notes.length > 0) {
        engine.setSequencerPattern(track.pattern);
        engine.startSequencer();
      } else if (!anyPattern && !chordPlayed) {
        chordPlayed = true;
        const notes =
          request.notes && request.notes.length > 0 ? request.notes.slice(0, 8) : [60, 64, 67];
        for (const n of notes) engine.noteOn(n, 100, 0.05);
        const offAt = Math.max(0.2, duration - 1.0);
        for (const n of notes) engine.noteOff(n, offAt);
      }
    }
  }, duration);

  return audioBufferToWav(toneBuffer.get() as unknown as RenderableBuffer);
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportFilename(prefix = 'wavesyn'): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}-mix-${stamp}.wav`;
}
