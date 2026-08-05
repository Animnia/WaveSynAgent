import { useSynthStore } from '@/stores/synthStore';
import Knob from './Knob';
import type { LFOWaveform, LFOTarget } from '@/engine/types';

const LFO_WAVEFORMS: { type: LFOWaveform; icon: string }[] = [
  { type: 'sine', icon: '∿' },
  { type: 'triangle', icon: '△' },
  { type: 'sawtooth', icon: '⊿' },
  { type: 'square', icon: '⊓' },
];

const LFO_TARGETS: { value: LFOTarget; label: string }[] = [
  { value: 'filterCutoff', label: 'Filter' },
  { value: 'volume', label: 'Vol' },
  { value: 'pitch', label: 'Pitch' },
  { value: 'pan', label: 'Pan' },
];

interface LFOPanelProps {
  index: 1 | 2;
}

export default function LFOPanel({ index }: LFOPanelProps) {
  const lfo = useSynthStore((s) => (index === 1 ? s.state.lfo1 : s.state.lfo2));
  const update = useSynthStore((s) => s.updateLFO);

  const color = index === 1 ? 'var(--color-accent-orange)' : 'var(--color-accent-pink)';

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        lfo.enabled
          ? 'bg-bg-panel border-border-active'
          : 'bg-bg-secondary border-border-default opacity-50'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            className={`w-3 h-3 rounded-full transition-colors`}
            style={{
              background: lfo.enabled ? color : 'var(--color-border-default)',
              boxShadow: lfo.enabled ? `0 0 8px ${color}` : 'none',
            }}
            onClick={() => update(index, { enabled: !lfo.enabled })}
          />
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
            LFO {index}
          </span>
        </div>
      </div>

      {/* Waveform */}
      <div className="flex gap-1 mb-2">
        {LFO_WAVEFORMS.map((w) => (
          <button
            key={w.type}
            className={`flex-1 py-0.5 rounded text-sm transition-all ${
              lfo.waveform === w.type
                ? 'bg-bg-tertiary text-text-primary border border-border-active'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            onClick={() => update(index, { waveform: w.type })}
          >
            {w.icon}
          </button>
        ))}
      </div>

      {/* Target */}
      <select
        className="w-full bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs text-text-secondary mb-2 outline-none focus:border-border-active"
        value={lfo.target}
        onChange={(e) => update(index, { target: e.target.value as LFOTarget })}
      >
        {LFO_TARGETS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Knobs */}
      <div className="grid grid-cols-2 gap-2">
        <Knob
          label="Rate"
          value={lfo.rate}
          min={0.01}
          max={50}
          step={0.01}
          size={44}
          color={color}
          format={(v) => (v >= 1 ? v.toFixed(1) : v.toFixed(2))}
          unit="Hz"
          onChange={(v) => update(index, { rate: v })}
        />
        <Knob
          label="Depth"
          value={lfo.depth}
          min={0}
          max={1}
          step={0.01}
          size={44}
          color={color}
          format={(v) => `${Math.round(v * 100)}`}
          unit="%"
          onChange={(v) => update(index, { depth: v })}
        />
      </div>
    </div>
  );
}
