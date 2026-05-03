import { useState, useEffect } from 'react';
import { usePresetStore } from '@/stores/presetStore';
import { useSynthStore } from '@/stores/synthStore';

export default function SavePresetDialog() {
  const open = usePresetStore((s) => s.saveDialogOpen);
  const toggle = usePresetStore((s) => s.toggleSaveDialog);
  const savePreset = usePresetStore((s) => s.savePreset);
  const overwritePreset = usePresetStore((s) => s.overwritePreset);
  const findByName = usePresetStore((s) => s.findByName);

  const synthState = useSynthStore((s) => s.state);

  const [name, setName] = useState('');
  const [tags, setTags] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setTags('');
    }
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    const n = name.trim();
    if (!n) return;
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);

    const existing = findByName(n);
    if (existing) {
      const ok = confirm(`已存在同名预设 "${n}"。是否覆盖？\n点击取消可改名后再保存。`);
      if (!ok) return;
      overwritePreset(existing.id, synthState);
    } else {
      savePreset(n, synthState, tagList);
    }
    toggle();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={toggle} aria-hidden />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-bg-secondary border border-border-default rounded-lg w-full max-w-md pointer-events-auto fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
            <span className="text-xs font-bold tracking-[0.2em] text-text-primary">SAVE PRESET</span>
            <button
              onClick={toggle}
              className="text-text-muted hover:text-text-primary p-1 leading-none"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
          <div className="px-4 py-4 space-y-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">
                Name
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                placeholder="My Pad"
                className="w-full bg-bg-tertiary border border-border-default focus:border-border-active px-3 py-2 text-sm text-text-primary outline-none rounded"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">
                Tags (逗号分隔，可选)
              </label>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="pad, warm"
                className="w-full bg-bg-tertiary border border-border-default focus:border-border-active px-3 py-2 text-xs text-text-secondary outline-none rounded"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
            <button
              onClick={toggle}
              className="px-3 py-1.5 text-xs text-text-secondary border border-border-default hover:border-border-active rounded transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="px-4 py-1.5 text-xs bg-text-primary text-bg-tertiary hover:bg-text-secondary disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
