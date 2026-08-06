import { useState, useRef } from 'react';
import { usePresetStore } from '@/stores/presetStore';
import { useSynthStore } from '@/stores/synthStore';
import type { PresetEntry } from '@/stores/presetStore';

export default function PresetBrowser() {
  const open = usePresetStore((s) => s.browserOpen);
  const toggle = usePresetStore((s) => s.toggleBrowser);
  const toggleSave = usePresetStore((s) => s.toggleSaveDialog);
  const presets = usePresetStore((s) => s.presets);
  const order = usePresetStore((s) => s.order);
  const renamePreset = usePresetStore((s) => s.renamePreset);
  const deletePreset = usePresetStore((s) => s.deletePreset);
  const exportPreset = usePresetStore((s) => s.exportPreset);
  const importPreset = usePresetStore((s) => s.importPreset);

  const setSynthState = useSynthStore((s) => s.setSynthState);

  const [filter, setFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const list = order
    .map((id) => presets[id])
    .filter(Boolean)
    .filter((p) =>
      filter ? p.name.toLowerCase().includes(filter.toLowerCase()) : true,
    );

  const factory = list.filter((p) => p.isFactory);
  const user = list.filter((p) => !p.isFactory);

  const handleLoad = (p: PresetEntry) => {
    setSynthState(p.synthState);
    toggle();
  };

  const handleExport = (p: PresetEntry) => {
    const json = exportPreset(p.id);
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.name.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        const id = importPreset(json);
        if (!id) alert('Import failed: invalid preset JSON');
      } catch {
        alert('Import failed: could not parse JSON');
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={toggle} aria-hidden />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-bg-secondary border border-border-default rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col pointer-events-auto fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
            <span className="text-xs font-bold tracking-[0.2em] text-text-primary">PRESETS</span>
            <button
              onClick={toggle}
              className="text-text-muted hover:text-text-primary p-1 leading-none"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="px-4 py-3 border-b border-border-default flex items-center gap-2">
            <input
              type="text"
              placeholder="Search presets..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="flex-1 bg-bg-tertiary border border-border-default px-3 py-1.5 text-xs text-text-primary outline-none focus:border-border-active rounded"
            />
            <button
              onClick={toggleSave}
              className="px-3 py-1.5 text-xs bg-text-primary text-bg-tertiary hover:bg-text-secondary rounded transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-xs text-text-secondary border border-border-default hover:border-border-active rounded transition-colors"
              title="Import preset JSON"
            >
              Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = '';
              }}
            />
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {user.length > 0 && (
              <Section title="USER">
                {user.map((p) => (
                  <PresetRow
                    key={p.id}
                    preset={p}
                    onLoad={() => handleLoad(p)}
                    onRename={(n) => renamePreset(p.id, n)}
                    onDelete={() => {
                      if (confirm(`Delete preset "${p.name}"?`)) deletePreset(p.id);
                    }}
                    onExport={() => handleExport(p)}
                  />
                ))}
              </Section>
            )}
            <Section title="FACTORY">
              {factory.map((p) => (
                <PresetRow
                  key={p.id}
                  preset={p}
                  onLoad={() => handleLoad(p)}
                  onExport={() => handleExport(p)}
                />
              ))}
              {factory.length === 0 && (
                <div className="text-text-muted text-xs px-2">No factory presets</div>
              )}
            </Section>
          </div>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2 px-1">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function PresetRow({
  preset,
  onLoad,
  onRename,
  onDelete,
  onExport,
}: {
  preset: PresetEntry;
  onLoad: () => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  onExport: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(preset.name);

  const commit = () => {
    const t = draft.trim();
    if (t && t !== preset.name && onRename) onRename(t);
    setEditing(false);
  };

  return (
    <div
      className="group flex items-center justify-between gap-2 border border-border-default bg-bg-tertiary hover:border-border-active rounded px-3 py-2 transition-colors cursor-pointer"
      onClick={() => !editing && onLoad()}
    >
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setDraft(preset.name); setEditing(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-bg-primary border border-border-active rounded px-1.5 py-0.5 text-xs text-text-primary outline-none"
          />
        ) : (
          <>
            <div className="text-xs text-text-primary font-medium truncate">{preset.name}</div>
            <div className="text-[10px] text-text-muted mt-0.5 flex items-center gap-2">
              {preset.isFactory && (
                <span className="px-1 py-px border border-border-default rounded">FACTORY</span>
              )}
              {preset.tags.map((t) => (
                <span key={t} className="text-text-muted">#{t}</span>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onRename && (
          <button
            onClick={(e) => { e.stopPropagation(); setDraft(preset.name); setEditing(true); }}
            className="text-text-muted hover:text-text-primary p-1 text-[11px]"
            title="Rename"
          >
            Edit
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onExport(); }}
          className="text-text-muted hover:text-text-primary p-1 text-[11px]"
          title="Export JSON"
        >
          JSON
        </button>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-text-muted hover:text-accent-red p-1 text-[11px]"
            title="Delete"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
