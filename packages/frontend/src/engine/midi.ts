/**
 * Web MIDI input — message parsing + device management.
 * The store (midiStore) owns lifecycle; this module is pure parsing/types.
 */

export type MidiEvent =
  | { type: 'noteOn'; note: number; velocity: number }
  | { type: 'noteOff'; note: number }
  | { type: 'cc'; controller: number; value: number }
  | { type: 'pitchBend'; value: number }; // -1..1

/** Parse a raw MIDI message. Returns null for unsupported/short messages. */
export function parseMidiMessage(data: Uint8Array | number[]): MidiEvent | null {
  if (data.length < 2) return null;
  const status = data[0];
  const command = status & 0xf0;
  const d1 = data[1];
  const d2 = data.length > 2 ? data[2] : 0;

  switch (command) {
    case 0x90: // note on (velocity 0 = note off, per MIDI convention)
      if (d2 === 0) return { type: 'noteOff', note: d1 };
      return { type: 'noteOn', note: d1, velocity: d2 };
    case 0x80:
      return { type: 'noteOff', note: d1 };
    case 0xb0:
      return { type: 'cc', controller: d1, value: d2 };
    case 0xe0: {
      // 14-bit value, center 8192
      const raw = (d2 << 7) | d1;
      return { type: 'pitchBend', value: (raw - 8192) / 8192 };
    }
    default:
      return null;
  }
}

export const CC_SUSTAIN = 64;
export const CC_MODWHEEL = 1;

export function isMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}
