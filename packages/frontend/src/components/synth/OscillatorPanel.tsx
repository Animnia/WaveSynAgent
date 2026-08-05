import { useSynthStore } from '@/stores/synthStore';
import Knob from './Knob';
import type { WaveformType } from '@/engine/types';

const WAVEFORMS: { type: WaveformType; label: string; icon: string }[] = [
  { type: 'sine', label: 'Sine', icon: '∿' },
  { type: 'triangle', label: 'Tri', icon: '△' },
  { type: 'sawtooth', label: 'Saw', icon: '⊿' },
  { type: 'square', label: 'Sq', icon: '⊓' },
];

interface OscillatorPanelProps {
  index: number;
}

export default function OscillatorPanel({ index }: OscillatorPanelProps) {
  const osc = useSynthStore((s) => s.state.oscillators[index]);
  const update = useSynthStore((s) => s.updateOscillator);

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        osc.enabled
          ? 'bg-bg-panel border-border-active'
          : 'bg-bg-secondary border-border-default opacity-50'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            className={`w-3 h-3 rounded-full transition-colors ${
              osc.enabled ? 'bg-accent-cyan glow-cyan' : 'bg-border-default'
            }`}
            onClick={() => update(index, { enabled: !osc.enabled })}
          />
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
            OSC {index + 1}
          </span>
        </div>
      </div>

      {/* Waveform selector */}
      <div className="flex gap-1 mb-3">
        {WAVEFORMS.map((w) => (
          <button
            key={w.type}
            className={`flex-1 py-1 px-1.5 rounded text-xs transition-all ${
              osc.type === w.type
                ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/50'
                : 'bg-bg-tertiary text-text-muted border border-transparent hover:border-border-active'
            }`}
            onClick={() => update(index, { type: w.type })}
          >
            <span className="block text-base leading-none">{w.icon}</span>
            <span className="block mt-0.5">{w.label}</span>
          </button>
        ))}
      </div>

      {/* Knobs */}
      <div className="grid grid-cols-3 gap-2">
        <Knob
          label="Volume"
          value={osc.volume}
          min={0}
          max={1}
          step={0.01}
          size={48}
          onChange={(v) => update(index, { volume: v })}
        />
        <Knob
          label="Semi"
          value={osc.semitone}
          min={-24}
          max={24}
          step={1}
          size={48}
          color="var(--color-accent-purple)"
          onChange={(v) => update(index, { semitone: v })}
        />
        <Knob
          label="Fine"
          value={osc.fine}
          min={-100}
          max={100}
          step={1}
          size={48}
          color="var(--color-accent-purple)"
          unit="ct"
          onChange={(v) => update(index, { fine: v })}
        />
        <Knob
          label="Pan"
          value={osc.pan}
          min={-1}
          max={1}
          step={0.01}
          size={48}
          color="var(--color-accent-orange)"
          onChange={(v) => update(index, { pan: v })}
        />
        <Knob
          label="Unison"
          value={osc.unison}
          min={1}
          max={8}
          step={1}
          size={48}
          color="var(--color-accent-pink)"
          onChange={(v) => update(index, { unison: v })}
        />
        <Knob
          label="Spread"
          value={osc.unisonSpread}
          min={0}
          max={100}
          step={1}
          size={48}
          color="var(--color-accent-pink)"
          unit="ct"
          onChange={(v) => update(index, { unisonSpread: v })}
        />
      </div>
    </div>
  );
}
