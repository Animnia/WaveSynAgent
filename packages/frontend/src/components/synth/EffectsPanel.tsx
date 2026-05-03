import { useSynthStore } from '@/stores/synthStore';
import Knob from './Knob';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { EffectId } from '@/engine/types';
import { DEFAULT_EFFECT_CHAIN } from '@/engine/types';

export default function EffectsPanel() {
  const effects = useSynthStore((s) => s.state.effects);
  const chain = useSynthStore((s) => s.state.effectChain) ?? DEFAULT_EFFECT_CHAIN;
  const update = useSynthStore((s) => s.updateEffects);
  const reorder = useSynthStore((s) => s.reorderEffectChain);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = chain.indexOf(active.id as EffectId);
    const newIndex = chain.indexOf(over.id as EffectId);
    if (oldIndex < 0 || newIndex < 0) return;
    reorder(arrayMove(chain, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={chain} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {chain.map((id) => (
            <SortableEffect key={id} id={id}>
              <EffectBody id={id} effects={effects} update={update} />
            </SortableEffect>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableEffect({ id, children }: { id: EffectId; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative">
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="absolute left-1 top-1/2 -translate-y-1/2 z-10 cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-primary text-xs select-none px-1"
        onClick={(e) => e.stopPropagation()}
      >
        ⋮⋮
      </button>
      {children}
    </div>
  );
}

type FxState = ReturnType<typeof useSynthStore.getState>['state']['effects'];
type Updater = ReturnType<typeof useSynthStore.getState>['updateEffects'];

function EffectBody({ id, effects, update }: { id: EffectId; effects: FxState; update: Updater }) {
  switch (id) {
    case 'reverb':
      return (
        <EffectSection
          name="Reverb"
          enabled={effects.reverb.enabled}
          onToggle={() => update({ reverb: { ...effects.reverb, enabled: !effects.reverb.enabled } })}
          color="var(--color-accent-cyan)"
        >
          <Knob label="Size" value={effects.reverb.size} min={0} max={1} step={0.01} size={40} color="var(--color-accent-cyan)" onChange={(v) => update({ reverb: { ...effects.reverb, size: v } })} />
          <Knob label="PreDly" value={effects.reverb.damping} min={0} max={1} step={0.01} size={40} color="var(--color-accent-cyan)" onChange={(v) => update({ reverb: { ...effects.reverb, damping: v } })} />
          <Knob label="Mix" value={effects.reverb.mix} min={0} max={1} step={0.01} size={40} color="var(--color-accent-cyan)" onChange={(v) => update({ reverb: { ...effects.reverb, mix: v } })} />
        </EffectSection>
      );
    case 'delay':
      return (
        <EffectSection
          name="Delay"
          enabled={effects.delay.enabled}
          onToggle={() => update({ delay: { ...effects.delay, enabled: !effects.delay.enabled } })}
          color="var(--color-accent-purple)"
        >
          <Knob label="Time" value={effects.delay.time} min={0.01} max={2} step={0.01} size={40} color="var(--color-accent-purple)" unit="s" onChange={(v) => update({ delay: { ...effects.delay, time: v } })} />
          <Knob label="FB" value={effects.delay.feedback} min={0} max={0.95} step={0.01} size={40} color="var(--color-accent-purple)" onChange={(v) => update({ delay: { ...effects.delay, feedback: v } })} />
          <Knob label="Mix" value={effects.delay.mix} min={0} max={1} step={0.01} size={40} color="var(--color-accent-purple)" onChange={(v) => update({ delay: { ...effects.delay, mix: v } })} />
        </EffectSection>
      );
    case 'chorus':
      return (
        <EffectSection
          name="Chorus"
          enabled={effects.chorus.enabled}
          onToggle={() => update({ chorus: { ...effects.chorus, enabled: !effects.chorus.enabled } })}
          color="var(--color-accent-pink)"
        >
          <Knob label="Rate" value={effects.chorus.rate} min={0.1} max={10} step={0.1} size={40} color="var(--color-accent-pink)" unit="Hz" onChange={(v) => update({ chorus: { ...effects.chorus, rate: v } })} />
          <Knob label="Depth" value={effects.chorus.depth} min={0} max={1} step={0.01} size={40} color="var(--color-accent-pink)" onChange={(v) => update({ chorus: { ...effects.chorus, depth: v } })} />
          <Knob label="Mix" value={effects.chorus.mix} min={0} max={1} step={0.01} size={40} color="var(--color-accent-pink)" onChange={(v) => update({ chorus: { ...effects.chorus, mix: v } })} />
        </EffectSection>
      );
    case 'distortion':
      return (
        <EffectSection
          name="Dist"
          enabled={effects.distortion.enabled}
          onToggle={() => update({ distortion: { ...effects.distortion, enabled: !effects.distortion.enabled } })}
          color="var(--color-accent-red)"
        >
          <Knob label="Drive" value={effects.distortion.drive} min={0} max={1} step={0.01} size={40} color="var(--color-accent-red)" onChange={(v) => update({ distortion: { ...effects.distortion, drive: v } })} />
          <Knob label="Mix" value={effects.distortion.mix} min={0} max={1} step={0.01} size={40} color="var(--color-accent-red)" onChange={(v) => update({ distortion: { ...effects.distortion, mix: v } })} />
        </EffectSection>
      );
    case 'compressor':
      return (
        <EffectSection
          name="Comp"
          enabled={effects.compressor.enabled}
          onToggle={() => update({ compressor: { ...effects.compressor, enabled: !effects.compressor.enabled } })}
          color="var(--color-accent-orange)"
        >
          <Knob label="Thresh" value={effects.compressor.threshold} min={-60} max={0} step={1} size={40} color="var(--color-accent-orange)" unit="dB" onChange={(v) => update({ compressor: { ...effects.compressor, threshold: v } })} />
          <Knob label="Ratio" value={effects.compressor.ratio} min={1} max={20} step={0.1} size={40} color="var(--color-accent-orange)" onChange={(v) => update({ compressor: { ...effects.compressor, ratio: v } })} />
          <Knob label="Atk" value={effects.compressor.attack} min={0.001} max={1} step={0.001} size={40} color="var(--color-accent-orange)" unit="s" onChange={(v) => update({ compressor: { ...effects.compressor, attack: v } })} />
          <Knob label="Rel" value={effects.compressor.release} min={0.01} max={1} step={0.01} size={40} color="var(--color-accent-orange)" unit="s" onChange={(v) => update({ compressor: { ...effects.compressor, release: v } })} />
        </EffectSection>
      );
    case 'eq3':
      return (
        <EffectSection
          name="EQ3"
          enabled={effects.eq3.enabled}
          onToggle={() => update({ eq3: { ...effects.eq3, enabled: !effects.eq3.enabled } })}
          color="var(--color-accent-blue)"
        >
          <Knob label="Low" value={effects.eq3.low} min={-24} max={24} step={0.5} size={40} color="var(--color-accent-blue)" unit="dB" onChange={(v) => update({ eq3: { ...effects.eq3, low: v } })} />
          <Knob label="Mid" value={effects.eq3.mid} min={-24} max={24} step={0.5} size={40} color="var(--color-accent-blue)" unit="dB" onChange={(v) => update({ eq3: { ...effects.eq3, mid: v } })} />
          <Knob label="High" value={effects.eq3.high} min={-24} max={24} step={0.5} size={40} color="var(--color-accent-blue)" unit="dB" onChange={(v) => update({ eq3: { ...effects.eq3, high: v } })} />
        </EffectSection>
      );
    case 'phaser':
      return (
        <EffectSection
          name="Phaser"
          enabled={effects.phaser.enabled}
          onToggle={() => update({ phaser: { ...effects.phaser, enabled: !effects.phaser.enabled } })}
          color="var(--color-accent-green)"
        >
          <Knob label="Rate" value={effects.phaser.rate} min={0.1} max={10} step={0.1} size={40} color="var(--color-accent-green)" unit="Hz" onChange={(v) => update({ phaser: { ...effects.phaser, rate: v } })} />
          <Knob label="Base" value={effects.phaser.baseFrequency} min={20} max={2000} step={10} size={40} color="var(--color-accent-green)" unit="Hz" onChange={(v) => update({ phaser: { ...effects.phaser, baseFrequency: v } })} />
          <Knob label="Oct" value={effects.phaser.octaves} min={1} max={7} step={1} size={40} color="var(--color-accent-green)" onChange={(v) => update({ phaser: { ...effects.phaser, octaves: v } })} />
          <Knob label="Mix" value={effects.phaser.mix} min={0} max={1} step={0.01} size={40} color="var(--color-accent-green)" onChange={(v) => update({ phaser: { ...effects.phaser, mix: v } })} />
        </EffectSection>
      );
    case 'bitCrusher':
      return (
        <EffectSection
          name="BitCrush"
          enabled={effects.bitCrusher.enabled}
          onToggle={() => update({ bitCrusher: { ...effects.bitCrusher, enabled: !effects.bitCrusher.enabled } })}
          color="var(--color-accent-yellow)"
        >
          <Knob label="Bits" value={effects.bitCrusher.bits} min={1} max={16} step={1} size={40} color="var(--color-accent-yellow)" onChange={(v) => update({ bitCrusher: { ...effects.bitCrusher, bits: v } })} />
          <Knob label="Mix" value={effects.bitCrusher.mix} min={0} max={1} step={0.01} size={40} color="var(--color-accent-yellow)" onChange={(v) => update({ bitCrusher: { ...effects.bitCrusher, mix: v } })} />
        </EffectSection>
      );
    case 'stereoWidener':
      return (
        <EffectSection
          name="Width"
          enabled={effects.stereoWidener.enabled}
          onToggle={() => update({ stereoWidener: { ...effects.stereoWidener, enabled: !effects.stereoWidener.enabled } })}
          color="var(--color-accent-cyan)"
        >
          <Knob label="Width" value={effects.stereoWidener.width} min={0} max={1} step={0.01} size={40} color="var(--color-accent-cyan)" onChange={(v) => update({ stereoWidener: { ...effects.stereoWidener, width: v } })} />
        </EffectSection>
      );
  }
}

function EffectSection({
  name,
  enabled,
  onToggle,
  color,
  children,
}: {
  name: string;
  enabled: boolean;
  onToggle: () => void;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-2 pl-6 transition-all ${
        enabled
          ? 'bg-bg-panel border-border-active'
          : 'bg-bg-secondary border-border-default opacity-60'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <button
          className="w-2.5 h-2.5 rounded-full transition-colors"
          style={{
            background: enabled ? color : 'var(--color-border-default)',
            boxShadow: enabled ? `0 0 6px ${color}` : 'none',
          }}
          onClick={onToggle}
        />
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">
          {name}
        </span>
      </div>
      <div className="flex gap-2 justify-center flex-wrap">{children}</div>
    </div>
  );
}
