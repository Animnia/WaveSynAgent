/**
 * Export orchestration shared by the header button and the agent tool.
 * Reads the track store, renders the full mix offline, triggers the download.
 */
import { useTracksStore } from '@/stores/tracksStore';
import {
  renderMixToWav,
  downloadBlob,
  exportFilename,
  type ExportRequest,
  type ExportTrack,
} from '@/engine/exporter';

let exporting = false;

export function isExporting(): boolean {
  return exporting;
}

export async function exportCurrentPatch(request: ExportRequest = {}): Promise<void> {
  if (exporting) return;
  exporting = true;
  try {
    const tracks: ExportTrack[] = useTracksStore.getState().tracks.map((t) => ({
      synthState: t.synthState,
      pattern: t.pattern,
      mixer: t.mixer,
    }));
    const blob = await renderMixToWav(tracks, request);
    downloadBlob(blob, exportFilename());
  } finally {
    exporting = false;
  }
}
