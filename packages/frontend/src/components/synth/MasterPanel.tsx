import { useSynthStore } from '@/stores/synthStore';
import Knob from './Knob';

export default function MasterPanel() {
  const master = useSynthStore((s) => s.state.master);
  const update = useSynthStore((s) => s.updateMaster);
  const panic = useSynthStore((s) => s.panic);

  return (
    <div className="flex items-center gap-4">
      <Knob
        label="Master"
        value={master.volume}
        min={0}
        max={1}
        step={0.01}
        size={48}
        color="var(--color-accent-green)"
        format={(v) => `${Math.round(v * 100)}`}
        unit="%"
        onChange={(v) => update({ volume: v })}
      />
      <Knob
        label="BPM"
        value={master.bpm}
        min={40}
        max={300}
        step={1}
        size={48}
        color="var(--color-accent-orange)"
        onChange={(v) => update({ bpm: v })}
      />
      <button
        className="px-3 py-1.5 bg-accent-red/20 text-accent-red text-xs rounded border border-accent-red/30 hover:bg-accent-red/30 transition-colors"
        onClick={panic}
      >
        PANIC
      </button>
    </div>
  );
}
