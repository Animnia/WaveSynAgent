import { useSynthStore } from '@/stores/synthStore';
import { useMidiStore } from '@/stores/midiStore';
import { MOD_SOURCES, MOD_TARGETS } from '@/engine/modTargets';
import type { ModDestination, ModSource } from '@/engine/types';

export default function ModMatrixPanel() {
  const routes = useSynthStore((s) => s.state.modulation) ?? [];
  const addRoute = useSynthStore((s) => s.addModRoute);
  const updateRoute = useSynthStore((s) => s.updateModRoute);
  const removeRoute = useSynthStore((s) => s.removeModRoute);
  const modWheel = useMidiStore((s) => s.modWheel);
  const setModWheel = useMidiStore((s) => s.setModWheel);

  return (
    <div className="bg-bg-panel border border-border-default rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">
          Mod Matrix
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
            WHEEL
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={modWheel}
              onChange={(e) => setModWheel(parseFloat(e.target.value))}
              className="w-16"
              title="Mod wheel (MIDI CC1)"
            />
            <span className="w-7 text-right tabular-nums">{modWheel.toFixed(2)}</span>
          </label>
          <button
            onClick={() => addRoute()}
            className="text-[10px] px-2 py-1 rounded border border-border-default hover:bg-bg-secondary text-text-secondary"
          >
            + ADD
          </button>
        </div>
      </div>

      {routes.length === 0 && (
        <p className="text-[10px] text-text-muted italic">
          No modulation routes. Click + ADD to create one.
        </p>
      )}

      <div className="space-y-1.5">
        {routes.map((route) => (
          <div
            key={route.id}
            className={`flex items-center gap-2 p-1.5 rounded border ${
              route.enabled
                ? 'border-border-active bg-bg-secondary'
                : 'border-border-default opacity-60'
            }`}
          >
            <button
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{
                background: route.enabled
                  ? 'var(--color-accent-cyan)'
                  : 'var(--color-border-default)',
                boxShadow: route.enabled ? '0 0 6px var(--color-accent-cyan)' : 'none',
              }}
              onClick={() => updateRoute(route.id, { enabled: !route.enabled })}
            />

            <select
              value={route.source}
              onChange={(e) =>
                updateRoute(route.id, { source: e.target.value as ModSource })
              }
              className="text-[11px] bg-transparent border border-border-default rounded px-1 py-0.5 text-text-primary"
            >
              {MOD_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            <span className="text-text-muted text-[10px]">→</span>

            <select
              value={route.destination}
              onChange={(e) =>
                updateRoute(route.id, {
                  destination: e.target.value as ModDestination,
                })
              }
              className="text-[11px] bg-transparent border border-border-default rounded px-1 py-0.5 text-text-primary flex-1"
            >
              {MOD_TARGETS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={route.depth}
              onChange={(e) =>
                updateRoute(route.id, { depth: parseFloat(e.target.value) })
              }
              className="w-16"
            />
            <span className="text-[10px] text-text-muted w-8 text-right tabular-nums">
              {route.depth.toFixed(2)}
            </span>

            <button
              onClick={() => removeRoute(route.id)}
              className="text-text-muted hover:text-accent-red text-xs px-1"
              aria-label="Remove route"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
