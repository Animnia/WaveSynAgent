import { useSynthStore } from '@/stores/synthStore';
import Knob from './Knob';

interface EnvelopePanelProps {
  type: 'amp' | 'filter';
}

export default function EnvelopePanel({ type }: EnvelopePanelProps) {
  const envelope = useSynthStore((s) =>
    type === 'amp' ? s.state.ampEnvelope : s.state.filterEnvelope,
  );
  const update = useSynthStore((s) =>
    type === 'amp' ? s.updateAmpEnvelope : s.updateFilterEnvelope,
  );

  const color =
    type === 'amp' ? 'var(--color-accent-green)' : 'var(--color-accent-pink)';
  const title = type === 'amp' ? 'AMP ENV' : 'FLT ENV';

  return (
    <div className="rounded-lg border bg-bg-panel border-border-active p-3">
      <span className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3 block">
        {title}
      </span>

      {/* ADSR Visualization */}
      <EnvelopeVisualizer envelope={envelope} color={color} />

      {/* Knobs */}
      <div className="grid grid-cols-4 gap-1 mt-2">
        <Knob
          label="A"
          value={envelope.attack}
          min={0.001}
          max={5}
          step={0.001}
          size={40}
          color={color}
          format={(v) => (v < 1 ? `${Math.round(v * 1000)}` : `${v.toFixed(1)}s`)}
          unit={envelope.attack < 1 ? 'ms' : ''}
          onChange={(v) => update({ attack: v })}
        />
        <Knob
          label="D"
          value={envelope.decay}
          min={0.001}
          max={5}
          step={0.001}
          size={40}
          color={color}
          format={(v) => (v < 1 ? `${Math.round(v * 1000)}` : `${v.toFixed(1)}s`)}
          unit={envelope.decay < 1 ? 'ms' : ''}
          onChange={(v) => update({ decay: v })}
        />
        <Knob
          label="S"
          value={envelope.sustain}
          min={0}
          max={1}
          step={0.01}
          size={40}
          color={color}
          format={(v) => `${Math.round(v * 100)}`}
          unit="%"
          onChange={(v) => update({ sustain: v })}
        />
        <Knob
          label="R"
          value={envelope.release}
          min={0.001}
          max={10}
          step={0.001}
          size={40}
          color={color}
          format={(v) => (v < 1 ? `${Math.round(v * 1000)}` : `${v.toFixed(1)}s`)}
          unit={envelope.release < 1 ? 'ms' : ''}
          onChange={(v) => update({ release: v })}
        />
      </div>
    </div>
  );
}

function EnvelopeVisualizer({
  envelope,
  color,
}: {
  envelope: { attack: number; decay: number; sustain: number; release: number };
  color: string;
}) {
  const w = 160;
  const h = 40;
  const pad = 4;

  const totalTime = envelope.attack + envelope.decay + 0.3 + envelope.release;
  const scale = (w - pad * 2) / totalTime;

  const aX = pad + envelope.attack * scale;
  const dX = aX + envelope.decay * scale;
  const sX = dX + 0.3 * scale;
  const rX = sX + envelope.release * scale;

  const top = pad;
  const bottom = h - pad;
  const sustainY = top + (1 - envelope.sustain) * (bottom - top);

  const path = `M ${pad} ${bottom} L ${aX} ${top} L ${dX} ${sustainY} L ${sX} ${sustainY} L ${rX} ${bottom}`;

  return (
    <svg width={w} height={h} className="w-full" viewBox={`0 0 ${w} ${h}`}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} opacity={0.8} />
      <path
        d={`${path} L ${pad} ${bottom}`}
        fill={color}
        opacity={0.08}
      />
    </svg>
  );
}
