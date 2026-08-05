import { describe, it, expect } from 'vitest';
import { parseMidiMessage } from './midi';

describe('parseMidiMessage', () => {
  it('parses note on with velocity', () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({ type: 'noteOn', note: 60, velocity: 100 });
  });

  it('treats note-on with velocity 0 as note off (MIDI convention)', () => {
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: 'noteOff', note: 60 });
  });

  it('parses explicit note off', () => {
    expect(parseMidiMessage([0x80, 64, 40])).toEqual({ type: 'noteOff', note: 64 });
  });

  it('parses control change', () => {
    expect(parseMidiMessage([0xb0, 64, 127])).toEqual({ type: 'cc', controller: 64, value: 127 });
  });

  it('parses pitch bend to -1..1', () => {
    expect(parseMidiMessage([0xe0, 0, 64])).toEqual({ type: 'pitchBend', value: 0 }); // center
    const up = parseMidiMessage([0xe0, 0x7f, 0x7f]);
    expect(up?.type).toBe('pitchBend');
    if (up?.type === 'pitchBend') expect(up.value).toBeCloseTo(1, 1);
    const down = parseMidiMessage([0xe0, 0, 0]);
    if (down?.type === 'pitchBend') expect(down.value).toBeCloseTo(-1, 1);
  });

  it('ignores unsupported or malformed messages', () => {
    expect(parseMidiMessage([0xf8])).toBeNull(); // clock
    expect(parseMidiMessage([0xc0, 5])).toBeNull(); // program change
    expect(parseMidiMessage([0x90])).toBeNull(); // too short
    expect(parseMidiMessage([])).toBeNull();
  });
});
