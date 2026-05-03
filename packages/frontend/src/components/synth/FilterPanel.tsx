import { useSynthStore } from '@/stores/synthStore';
import Knob from './Knob';
import type { FilterType } from '@/engine/types';

const FILTER_TYPES: { type: FilterType; label: string }[] = [
  { type: 'lowpass', label: 'LP' },
  { type: 'highpass', label: 'HP' },
  { type: 'bandpass', label: 'BP' },
  { type: 'notch', label: 'NT' },
];

export default function FilterPanel() {
  const filter = useSynthStore((s) => s.state.filter);
  const update = useSynthStore((s) => s.updateFilter);

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        filter.enabled
          ? 'bg-bg-panel border-border-active'
          : 'bg-bg-secondary border-border-default opacity-50'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            className={`w-3 h-3 rounded-full transition-colors ${
              filter.enabled ? 'bg-accent-purple glow-purple' : 'bg-border-default'
            }`}
            onClick={() => update({ enabled: !filter.enabled })}
          />
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
            Filter
          </span>
        </div>
      </div>

      {/* Filter type selector */}
      <div className="flex gap-1 mb-3">
        {FILTER_TYPES.map((f) => (
          <button
            key={f.type}
            className={`flex-1 py-1 rounded text-xs transition-all ${
              filter.type === f.type
                ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/50'
                : 'bg-bg-tertiary text-text-muted border border-transparent hover:border-border-active'
            }`}
            onClick={() => update({ type: f.type })}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Knobs */}
      <div className="grid grid-cols-2 gap-2">
        <Knob
          label="Cutoff"
          value={filter.cutoff}
          min={20}
          max={20000}
          step={1}
          size={56}
          color="var(--color-accent-purple)"
          format={(v) =>
            v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString()
          }
          unit="Hz"
          onChange={(v) => update({ cutoff: v })}
        />
        <Knob
          label="Reso"
          value={filter.resonance}
          min={0}
          max={1}
          step={0.01}
          size={56}
          color="var(--color-accent-purple)"
          onChange={(v) => update({ resonance: v })}
        />
        <Knob
          label="Env Amt"
          value={filter.envelopeAmount}
          min={-1}
          max={1}
          step={0.01}
          size={48}
          color="var(--color-accent-pink)"
          onChange={(v) => update({ envelopeAmount: v })}
        />
        <Knob
          label="Key Trk"
          value={filter.keyTracking}
          min={0}
          max={1}
          step={0.01}
          size={48}
          color="var(--color-accent-pink)"
          onChange={(v) => update({ keyTracking: v })}
        />
      </div>
    </div>
  );
}
