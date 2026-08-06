import { describe, it, expect } from 'vitest';
import { audioBufferToWav, exportFilename } from './exporter';

function fakeBuffer(frames: number, channels: Float32Array[], sampleRate = 44100) {
  return {
    numberOfChannels: channels.length,
    length: frames,
    sampleRate,
    getChannelData: (i: number) => channels[i],
  };
}

async function blobBytes(blob: Blob): Promise<DataView> {
  const buf = await blob.arrayBuffer();
  return new DataView(buf);
}

describe('audioBufferToWav', () => {
  it('writes a valid RIFF/WAVE header', async () => {
    const blob = audioBufferToWav(fakeBuffer(4, [new Float32Array(4), new Float32Array(4)]));
    const v = await blobBytes(blob);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(String.fromCharCode(v.getUint8(8), v.getUint8(9), v.getUint8(10), v.getUint8(11))).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2); // stereo
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint16(34, true)).toBe(16); // bit depth
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2); // data size
  });

  it('encodes 16-bit PCM with correct scaling and clipping', async () => {
    const left = new Float32Array([0, 0.5, -0.5, 2.0]); // 2.0 must clip to 1.0
    const right = new Float32Array([1.0, -1.0, 0.25, -2.0]);
    const blob = audioBufferToWav(fakeBuffer(4, [left, right]));
    const v = await blobBytes(blob);

    // frame 0: L=0 → 0, R=1.0 → 32767
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(32767);
    // frame 1: L=0.5 → 16383, R=-1.0 → -32768
    expect(v.getInt16(48, true)).toBe(16383);
    expect(v.getInt16(50, true)).toBe(-32768);
    // frame 3: L=2.0 clips to 32767, R=-2.0 clips to -32768
    expect(v.getInt16(56, true)).toBe(32767);
    expect(v.getInt16(58, true)).toBe(-32768);
  });

  it('upmixes mono to stereo', async () => {
    const mono = new Float32Array([0.5, -0.5]);
    const blob = audioBufferToWav(fakeBuffer(2, [mono]));
    const v = await blobBytes(blob);
    expect(v.getUint16(22, true)).toBe(2);
    // both channels carry the mono signal
    expect(v.getInt16(44, true)).toBe(v.getInt16(46, true));
  });
});

describe('exportFilename', () => {
  it('produces a timestamped wav name', () => {
    expect(exportFilename()).toMatch(/^wavesyn-mix-\d{8}-\d{6}\.wav$/);
  });
});
