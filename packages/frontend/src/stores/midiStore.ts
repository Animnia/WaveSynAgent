import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getAudioEngine } from '@/engine/AudioEngine';
import { isMidiSupported, parseMidiMessage, CC_SUSTAIN, CC_MODWHEEL } from '@/engine/midi';
import { useSynthStore } from './synthStore';

export interface MidiInputInfo {
  id: string;
  name: string;
}

interface MidiState {
  supported: boolean;
  /** Whether we're currently listening (user-toggleable). */
  enabled: boolean;
  inputs: MidiInputInfo[];
  error: string | null;
  /** Mod wheel position 0..1 (MIDI CC1 or the ModMatrix slider). */
  modWheel: number;
}

interface MidiActions {
  /** Request access and attach listeners. Safe to call repeatedly. */
  init: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  setModWheel: (value: number) => void;
}

let access: MIDIAccess | null = null;

function handleMessage(data: Uint8Array): void {
  const evt = parseMidiMessage(data);
  if (!evt) return;
  const synth = useSynthStore.getState();
  switch (evt.type) {
    case 'noteOn':
      void getAudioEngine().start().then(() => synth.noteOn(evt.note, evt.velocity));
      break;
    case 'noteOff':
      synth.noteOff(evt.note);
      break;
    case 'cc':
      if (evt.controller === CC_SUSTAIN) {
        getAudioEngine().setSustain(evt.value >= 64);
      } else if (evt.controller === CC_MODWHEEL) {
        useMidiStore.getState().setModWheel(evt.value / 127);
      }
      break;
    default:
      break; // pitch bend etc. — reserved
  }
}

function attachAll(set: (fn: (s: MidiState) => void) => void): void {
  if (!access) return;
  const inputs: MidiInputInfo[] = [];
  access.inputs.forEach((input) => {
    inputs.push({ id: input.id, name: input.name ?? input.id });
    input.onmidimessage = (e: MIDIMessageEvent) => {
      if (e.data) handleMessage(e.data);
    };
  });
  set((s) => { s.inputs = inputs; });
}

function detachAll(): void {
  access?.inputs.forEach((input) => {
    input.onmidimessage = null;
  });
}

export const useMidiStore = create<MidiState & MidiActions>()(
  immer((set, get) => ({
    supported: isMidiSupported(),
    enabled: false,
    inputs: [],
    error: null,
    modWheel: 0,

    init: async () => {
      if (!isMidiSupported()) {
        set((s) => { s.error = '此浏览器不支持 Web MIDI（推荐 Chrome/Edge）'; });
        return;
      }
      try {
        access ??= await navigator.requestMIDIAccess();
        access.onstatechange = () => {
          if (get().enabled) attachAll(set);
        };
        attachAll(set);
        set((s) => {
          s.enabled = true;
          s.error = null;
        });
      } catch {
        set((s) => { s.error = 'MIDI 访问被拒绝'; });
      }
    },

    setEnabled: (enabled) => {
      set((s) => { s.enabled = enabled; });
      if (enabled) {
        void get().init();
      } else {
        detachAll();
      }
    },

    setModWheel: (value) => {
      const v = Math.min(1, Math.max(0, value));
      set((s) => { s.modWheel = v; });
      getAudioEngine().setModWheel(v);
    },
  })),
);
