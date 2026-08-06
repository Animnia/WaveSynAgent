/**
 * Per-track engine registry. Each track owns an AudioEngine whose output is
 * routed through its mixer channel strip. `getAudioEngine()` (the API most
 * callers use) returns the ACTIVE track's engine.
 */
import { AudioEngine } from './AudioEngine';
import { getChannel, removeChannel } from './mixer';

const engines = new Map<string, AudioEngine>();
let activeTrackId: string | null = null;

/** Get (creating + wiring if needed) the engine for a track. */
export function getTrackEngine(trackId: string): AudioEngine {
  let engine = engines.get(trackId);
  if (!engine) {
    engine = new AudioEngine();
    engine.output.connect(getChannel(trackId).input);
    engines.set(trackId, engine);
  }
  return engine;
}

export function hasTrackEngine(trackId: string): boolean {
  return engines.has(trackId);
}

export function removeTrackEngine(trackId: string): void {
  const engine = engines.get(trackId);
  if (!engine) return;
  engine.output.disconnect();
  engine.dispose();
  removeChannel(trackId);
  engines.delete(trackId);
}

/** Called by tracksStore when the active track changes. */
export function setActiveEngineTrack(trackId: string): void {
  activeTrackId = trackId;
}

export function getActiveTrackId(): string | null {
  return activeTrackId;
}

/**
 * The active track's engine. Falls back to the first registered engine when
 * no active id is set (e.g. during store hydration).
 */
export function getAudioEngine(): AudioEngine {
  if (activeTrackId) return getTrackEngine(activeTrackId);
  const first = engines.keys().next().value;
  if (first) return getTrackEngine(first);
  // No tracks registered yet — bootstrap a default one. tracksStore will
  // claim this id on init.
  return getTrackEngine('track-1');
}

/** Stop the shared Transport (all tracks' parts halt with it). */
export function stopAllEngines(): void {
  for (const engine of engines.values()) {
    engine.stopSequencer();
  }
}
