import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { SynthState } from '@/engine/types';
import { FACTORY_PRESETS } from '@/engine/factoryPresets';

export interface PresetEntry {
  id: string;
  name: string;
  tags: string[];
  synthState: SynthState;
  isFactory: boolean;
  createdAt: number;
  updatedAt: number;
}

interface PresetState {
  presets: Record<string, PresetEntry>;
  order: string[];
  browserOpen: boolean;
  saveDialogOpen: boolean;
}

interface PresetActions {
  savePreset: (name: string, synthState: SynthState, tags?: string[]) => string;
  overwritePreset: (id: string, synthState: SynthState) => void;
  renamePreset: (id: string, name: string) => void;
  deletePreset: (id: string) => void;
  importPreset: (json: unknown) => string | null;
  exportPreset: (id: string) => string | null;
  toggleBrowser: () => void;
  toggleSaveDialog: () => void;
  findByName: (name: string) => PresetEntry | undefined;
}

function buildFactoryEntries(): { presets: Record<string, PresetEntry>; order: string[] } {
  const presets: Record<string, PresetEntry> = {};
  const order: string[] = [];
  const now = Date.now();
  for (const fp of FACTORY_PRESETS) {
    presets[fp.id] = {
      id: fp.id,
      name: fp.name,
      tags: fp.tags,
      synthState: fp.synthState,
      isFactory: true,
      createdAt: now,
      updatedAt: now,
    };
    order.push(fp.id);
  }
  return { presets, order };
}

const initial = buildFactoryEntries();

export const usePresetStore = create<PresetState & PresetActions>()(
  persist(
    immer((set, get) => ({
      presets: initial.presets,
      order: initial.order,
      browserOpen: false,
      saveDialogOpen: false,

      toggleBrowser: () => set((s) => { s.browserOpen = !s.browserOpen; }),
      toggleSaveDialog: () => set((s) => { s.saveDialogOpen = !s.saveDialogOpen; }),

      findByName: (name) => {
        const all = Object.values(get().presets);
        return all.find((p) => p.name.toLowerCase() === name.toLowerCase() && !p.isFactory);
      },

      savePreset: (name, synthState, tags = []) => {
        const id = `user:${crypto.randomUUID()}`;
        const now = Date.now();
        const entry: PresetEntry = {
          id,
          name,
          tags,
          synthState: JSON.parse(JSON.stringify(synthState)),
          isFactory: false,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => {
          s.presets[id] = entry;
          s.order.unshift(id);
        });
        return id;
      },

      overwritePreset: (id, synthState) => {
        set((s) => {
          const p = s.presets[id];
          if (p && !p.isFactory) {
            p.synthState = JSON.parse(JSON.stringify(synthState));
            p.updatedAt = Date.now();
          }
        });
      },

      renamePreset: (id, name) => {
        set((s) => {
          const p = s.presets[id];
          if (p && !p.isFactory) {
            p.name = name || 'Untitled';
            p.updatedAt = Date.now();
          }
        });
      },

      deletePreset: (id) => {
        set((s) => {
          const p = s.presets[id];
          if (!p || p.isFactory) return;
          delete s.presets[id];
          s.order = s.order.filter((x) => x !== id);
        });
      },

      importPreset: (json) => {
        try {
          const obj = json as { name?: string; tags?: string[]; synthState?: SynthState };
          if (!obj || typeof obj !== 'object' || !obj.synthState) return null;
          return get().savePreset(obj.name || 'Imported', obj.synthState, obj.tags || []);
        } catch {
          return null;
        }
      },

      exportPreset: (id) => {
        const p = get().presets[id];
        if (!p) return null;
        return JSON.stringify(
          { name: p.name, tags: p.tags, synthState: p.synthState },
          null,
          2,
        );
      },
    })),
    {
      name: 'synth-presets',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ presets: s.presets, order: s.order }),
      merge: (persisted, current) => {
        const p = (persisted as Partial<PresetState>) || {};
        // Always re-inject factory presets fresh from code
        const factory = buildFactoryEntries();
        const userPresets: Record<string, PresetEntry> = {};
        const userOrder: string[] = [];
        for (const id of p.order || []) {
          const entry = p.presets?.[id];
          if (entry && !entry.isFactory) {
            userPresets[id] = entry;
            userOrder.push(id);
          }
        }
        return {
          ...current,
          presets: { ...factory.presets, ...userPresets },
          order: [...userOrder, ...factory.order],
        };
      },
    },
  ),
);
