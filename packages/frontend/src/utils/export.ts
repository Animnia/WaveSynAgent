/**
 * Export orchestration shared by the header button and the agent tool.
 * Reads the live stores, renders offline, and triggers the download.
 */
import { useSynthStore } from '@/stores/synthStore';
import { useSequencerStore } from '@/stores/sequencerStore';
import {
  renderPatchToWav,
  downloadBlob,
  exportFilename,
  type ExportRequest,
} from '@/engine/exporter';

let exporting = false;

export function isExporting(): boolean {
  return exporting;
}

export async function exportCurrentPatch(request: ExportRequest = {}): Promise<void> {
  if (exporting) return;
  exporting = true;
  try {
    const state = useSynthStore.getState().state;
    const seq = useSequencerStore.getState();
    const pattern = seq.pattern.notes.length > 0 ? seq.pattern : null;
    const blob = await renderPatchToWav(state, pattern, request);
    downloadBlob(blob, exportFilename());
  } finally {
    exporting = false;
  }
}
