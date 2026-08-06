import { Fragment } from 'react';
import { useTracksStore, useActiveTrack } from '@/stores/tracksStore';
import { midiToNoteName } from '@/engine/types';

/**
 * 16/32-step sequencer grid for the ACTIVE track (each track owns its
 * pattern). Rows form one chromatic octave (top = highest); columns are
 * sixteenth-note steps. Click a cell to toggle a note.
 */
export default function SequencerPanel() {
  const track = useActiveTrack();
  const currentStep = useTracksStore((s) => s.currentStep);
  const baseNote = useTracksStore((s) => s.seqBaseNote);
  const setSeqBaseNote = useTracksStore((s) => s.setSeqBaseNote);
  const toggleTrack = useTracksStore((s) => s.toggleTrack);
  const toggleCell = useTracksStore((s) => s.toggleSeqCell);
  const clearPattern = useTracksStore((s) => s.clearSeqPattern);
  const setSteps = useTracksStore((s) => s.setSeqSteps);

  if (!track) return null;
  const { pattern, playing, id: trackId } = track;

  // Top row = highest note of the octave
  const rows = Array.from({ length: 12 }, (_, i) => baseNote + 11 - i);
  const steps = pattern.steps;

  const isActive = (note: number, step: number) =>
    pattern.notes.some((n) => n.note === note && n.start === step);

  return (
    <div className="border-t border-border-default bg-bg-secondary px-3 py-2">
      {/* Controls */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => void toggleTrack(trackId)}
          className={`px-3 py-1 text-xs rounded border transition-colors ${
            playing
              ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50'
              : 'bg-bg-tertiary text-text-secondary border-border-default hover:border-border-active'
          }`}
        >
          {playing ? '■ Stop' : '▶ Play'}
        </button>

        <div className="flex border border-border-default rounded overflow-hidden">
          {([16, 32] as const).map((n) => (
            <button
              key={n}
              onClick={() => setSteps(trackId, n)}
              className={`px-2 py-1 text-[10px] transition-colors ${
                steps === n
                  ? 'bg-accent-cyan/20 text-accent-cyan'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <button
          onClick={() => clearPattern(trackId)}
          className="px-2 py-1 text-[10px] bg-bg-tertiary text-text-muted border border-border-default rounded hover:text-accent-red transition-colors"
        >
          Clear
        </button>

        <span className="text-[10px] text-text-muted ml-auto flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-primary" />
          {track.name} · {pattern.notes.length} notes
        </span>
      </div>

      {/* Grid + pitch-range slider */}
      <div className="flex gap-2">
        {/* Vertical pitch-range slider: drag to shift the grid's octave window */}
        <div className="flex flex-col items-center flex-shrink-0 select-none">
          <span className="text-[9px] font-mono text-text-muted mb-1">
            {midiToNoteName(baseNote + 11)}
          </span>
          <input
            type="range"
            min={24}
            max={96}
            step={1}
            value={baseNote}
            onChange={(e) => setSeqBaseNote(parseInt(e.target.value, 10))}
            className="range-vertical"
            aria-label="Pitch range"
            title={`Pitch range (bottom row ${midiToNoteName(baseNote)})`}
          />
          <span className="text-[9px] font-mono text-text-muted mt-1">
            {midiToNoteName(baseNote)}
          </span>
        </div>

        <div className="overflow-x-auto flex-1">
        <div
          className="grid gap-[2px]"
          style={{ gridTemplateColumns: `56px repeat(${steps}, minmax(18px, 1fr))` }}
        >
          {rows.map((note) => (
            <Fragment key={note}>
              <div
                className={`text-[9px] font-mono flex items-center justify-end pr-1 select-none ${
                  NOTE_ROW_NAMES[note % 12].includes('#') ? 'text-text-muted/60' : 'text-text-muted'
                }`}
              >
                {midiToNoteName(note)}
              </div>
              {Array.from({ length: steps }, (_, step) => {
                const active = isActive(note, step);
                const isCurrent = playing && step === currentStep;
                const isBeat = step % 4 === 0;
                return (
                  <button
                    key={`${note}-${step}`}
                    onClick={() => toggleCell(trackId, note, step)}
                    className={`h-4 rounded-[2px] transition-colors ${
                      active
                        ? isCurrent
                          ? 'bg-accent-cyan'
                          : 'bg-accent-cyan/70 hover:bg-accent-cyan'
                        : isCurrent
                          ? 'bg-bg-hover'
                          : isBeat
                            ? 'bg-bg-tertiary hover:bg-bg-hover'
                            : 'bg-bg-primary hover:bg-bg-hover'
                    }`}
                    aria-label={`${midiToNoteName(note)} step ${step + 1}`}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}

const NOTE_ROW_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
