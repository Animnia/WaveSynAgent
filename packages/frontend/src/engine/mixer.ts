/**
 * Master mixer — the shared bus every track engine routes through.
 *
 *   engine.output → channel(input→gain→panner) → masterIn → limiter → out
 *
 * Mute/solo is resolved by `resolveAudibility` and applied to channel gains.
 */
import * as Tone from 'tone';

export interface MixerParams {
  volume: number; // 0..1
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
}

export const DEFAULT_MIXER: MixerParams = { volume: 0.8, pan: 0, mute: false, solo: false };

interface ChannelStrip {
  input: Tone.Gain;
  gain: Tone.Gain;
  panner: Tone.Panner;
}

let masterIn: Tone.Gain | null = null;
let limiter: Tone.Limiter | null = null;
const channels = new Map<string, ChannelStrip>();

function getMasterIn(): Tone.Gain {
  if (!masterIn) {
    masterIn = new Tone.Gain(1);
    limiter = new Tone.Limiter(-1); // safety ceiling for multi-track sums
    masterIn.connect(limiter);
    limiter.toDestination();
  }
  return masterIn;
}

/** Get (creating if needed) the channel strip for a track. */
export function getChannel(trackId: string): ChannelStrip {
  let ch = channels.get(trackId);
  if (!ch) {
    const input = new Tone.Gain(1);
    const gain = new Tone.Gain(DEFAULT_MIXER.volume);
    const panner = new Tone.Panner(DEFAULT_MIXER.pan);
    input.connect(gain);
    gain.connect(panner);
    panner.connect(getMasterIn());
    ch = { input, gain, panner };
    channels.set(trackId, ch);
  }
  return ch;
}

/**
 * Given each track's mute/solo flags, return which track ids are audible
 * (any solo → only solos; otherwise all non-muted).
 */
export function resolveAudibility(
  tracks: { id: string; mute: boolean; solo: boolean }[],
): Set<string> {
  const anySolo = tracks.some((t) => t.solo);
  const audible = new Set<string>();
  for (const t of tracks) {
    if (anySolo ? t.solo : !t.mute) audible.add(t.id);
  }
  return audible;
}

/** Apply mixer params to a channel strip (ramped; `audible` comes from resolveAudibility). */
export function applyMixerParams(
  trackId: string,
  params: MixerParams,
  audible: boolean,
): void {
  const ch = getChannel(trackId);
  const now = Tone.now();
  ch.gain.gain.setTargetAtTime(audible ? params.volume : 0, now, 0.02);
  ch.panner.pan.setTargetAtTime(params.pan, now, 0.02);
}

export function removeChannel(trackId: string): void {
  const ch = channels.get(trackId);
  if (!ch) return;
  ch.input.disconnect();
  ch.input.dispose();
  ch.gain.dispose();
  ch.panner.dispose();
  channels.delete(trackId);
}
