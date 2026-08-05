import { Fragment } from 'react';
import { useSequencerStore } from '@/stores/sequencerStore';
import { midiToNoteName } from '@/engine/types';

/**
 * 16/32-step sequencer grid. Rows form one chromatic octave (top = highest),
 * columns are sixteenth-note steps. Click a cell to toggle a note.
 * The pattern always plays through the live patch.
 */
export default function SequencerPanel() {
  const pattern = useSequencerStore((s) => s.pattern);
  const playing = useSequencerStore((s) => s.playing);
  const currentStep = useSequencerStore((s) => s.currentStep);
  const baseNote = useSequencerStore((s) => s.baseNote);
  const toggle = useSequencerStore((s) => s.toggle);
  const toggleCell = useSequencerStore((s) => s.toggleCell);
  const clearPattern = useSequencerStore((s) => s.clearPattern);
  const setSteps = useSequencerStore((s) => s.setSteps);
  const shiftOctave = useSequencerStore((s) => s.shiftOctave);

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
          onClick={() => void toggle()}
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
              onClick={() => setSteps(n)}
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

        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftOctave(-1)}
            disabled={baseNote <= 24}
            className="px-1.5 py-1 text-[10px] bg-bg-tertiary text-text-muted border border-border-default rounded hover:text-text-secondary disabled:opacity-30"
          >
            −8ve
          </button>
          <span className="text-[10px] text-text-muted w-8 text-center">
            {midiToNoteName(baseNote)}
          </span>
          <button
            onClick={() => shiftOctave(1)}
            disabled={baseNote >= 96}
            className="px-1.5 py-1 text-[10px] bg-bg-tertiary text-text-muted border border-border-default rounded hover:text-text-secondary disabled:opacity-30"
          >
            +8ve
          </button>
        </div>

        <button
          onClick={clearPattern}
          className="px-2 py-1 text-[10px] bg-bg-tertiary text-text-muted border border-border-default rounded hover:text-accent-red transition-colors"
        >
          Clear
        </button>

        <span className="text-[10px] text-text-muted ml-auto">
          {pattern.notes.length} notes · plays through current patch
        </span>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
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
                    onClick={() => toggleCell(note, step)}
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
  );
}

const NOTE_ROW_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
