import { useCallback, useEffect, useRef } from 'react';
import { useSynthStore } from '@/stores/synthStore';
import { getAudioEngine } from '@/engine/registry';
import { midiToNoteName } from '@/engine/types';

// Computer keyboard mapping — two-row piano layout starting at C4
const KEY_MAP: Record<string, number> = {
  // Lower octave (C4)
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66,
  g: 67, y: 68, h: 69, u: 70, j: 71,
  // Upper octave (C5)
  k: 72, o: 73, l: 74, p: 75, ';': 76, "'": 77, ']': 78,
  // Octave below (ZXCVBNM => C3..B3)
  z: 48, x: 50, c: 52, v: 53, b: 55, n: 57, m: 59,
};

interface VirtualKeyboardProps {
  startOctave?: number;
  octaves?: number;
}

export default function VirtualKeyboard({
  startOctave = 3,
  octaves = 3,
}: VirtualKeyboardProps) {
  const noteOn = useSynthStore((s) => s.noteOn);
  const noteOff = useSynthStore((s) => s.noteOff);
  const activeNotes = useSynthStore((s) => s.activeNotes);

  const pressedKeys = useRef(new Set<string>());
  // Map pointerId -> midi held by that pointer (supports multi-touch).
  const pointerNotes = useRef(new Map<number, number>());

  // Computer keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const key = e.key.toLowerCase();
      if (key in KEY_MAP && !pressedKeys.current.has(key)) {
        pressedKeys.current.add(key);
        void getAudioEngine().start();
        noteOn(KEY_MAP[key], 100);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key in KEY_MAP && pressedKeys.current.has(key)) {
        pressedKeys.current.delete(key);
        noteOff(KEY_MAP[key]);
      }
    };

    const handleBlur = () => {
      for (const k of pressedKeys.current) noteOff(KEY_MAP[k]);
      pressedKeys.current.clear();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [noteOn, noteOff]);

  // Cleanup any held notes when unmounting (e.g. fast-refresh, route change)
  useEffect(() => {
    const map = pointerNotes.current;
    return () => {
      for (const midi of map.values()) noteOff(midi);
      map.clear();
    };
  }, [noteOff]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, midi: number) => {
      e.preventDefault();
      // Capture so we always receive pointerup/cancel even if pointer leaves.
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch { /* noop */ }
      void getAudioEngine().start();
      const prev = pointerNotes.current.get(e.pointerId);
      if (prev !== undefined && prev !== midi) noteOff(prev);
      pointerNotes.current.set(e.pointerId, midi);
      noteOn(midi, 100);
    },
    [noteOn, noteOff],
  );

  const handlePointerUpOrCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const midi = pointerNotes.current.get(e.pointerId);
      if (midi !== undefined) {
        noteOff(midi);
        pointerNotes.current.delete(e.pointerId);
      }
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch { /* noop */ }
    },
    [noteOff],
  );

  const handlePointerEnter = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, midi: number) => {
      // Only switch the held note when the user is actively dragging across keys.
      // With pointer capture set on the original key, dragging into a sibling
      // key fires pointerover/enter on the *new* element (capture only affects
      // up/move/cancel, not over/enter for sibling targets in Chromium).
      if (!(e.buttons & 1)) return;
      const prev = pointerNotes.current.get(e.pointerId);
      if (prev === midi) return;
      if (prev !== undefined) noteOff(prev);
      noteOn(midi, 100);
      pointerNotes.current.set(e.pointerId, midi);
    },
    [noteOn, noteOff],
  );

  // Build keys
  const keys: { midi: number; isBlack: boolean }[] = [];
  for (let oct = startOctave; oct < startOctave + octaves; oct++) {
    for (let i = 0; i < 12; i++) {
      keys.push({
        midi: (oct + 1) * 12 + i,
        isBlack: [1, 3, 6, 8, 10].includes(i),
      });
    }
  }
  keys.push({ midi: (startOctave + octaves + 1) * 12, isBlack: false });

  const whiteKeys = keys.filter((k) => !k.isBlack);
  const blackKeys = keys.filter((k) => k.isBlack);
  const whiteKeyWidth = 100 / whiteKeys.length;

  const blackKeyPositions = blackKeys.map((bk) => {
    const whiteIndex = whiteKeys.findIndex((wk) => wk.midi > bk.midi) - 1;
    return { midi: bk.midi, left: (whiteIndex + 0.65) * whiteKeyWidth };
  });

  return (
    <div className="relative w-full select-none touch-none" style={{ height: 80 }}>
      {/* White keys */}
      {whiteKeys.map((k, i) => {
        const isActive = activeNotes.has(k.midi);
        return (
          <div
            key={k.midi}
            className={`absolute top-0 bottom-0 border-r border-border-default transition-colors cursor-pointer ${
              isActive ? 'bg-text-primary' : 'bg-bg-tertiary hover:bg-bg-hover'
            }`}
            style={{
              left: `${i * whiteKeyWidth}%`,
              width: `${whiteKeyWidth}%`,
              touchAction: 'none',
            }}
            onPointerDown={(e) => handlePointerDown(e, k.midi)}
            onPointerUp={handlePointerUpOrCancel}
            onPointerCancel={handlePointerUpOrCancel}
            onPointerEnter={(e) => handlePointerEnter(e, k.midi)}
          >
            {k.midi % 12 === 0 && (
              <span
                className={`absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] ${
                  isActive ? 'text-bg-tertiary' : 'text-text-muted'
                }`}
              >
                {midiToNoteName(k.midi)}
              </span>
            )}
          </div>
        );
      })}

      {/* Black keys */}
      {blackKeyPositions.map((bk) => {
        const isActive = activeNotes.has(bk.midi);
        return (
          <div
            key={bk.midi}
            className={`absolute top-0 z-10 cursor-pointer transition-colors border-x border-b border-border-default ${
              isActive ? 'bg-text-secondary' : 'bg-text-primary hover:bg-text-secondary'
            }`}
            style={{
              left: `${bk.left}%`,
              width: `${whiteKeyWidth * 0.6}%`,
              height: '55%',
              touchAction: 'none',
            }}
            onPointerDown={(e) => handlePointerDown(e, bk.midi)}
            onPointerUp={handlePointerUpOrCancel}
            onPointerCancel={handlePointerUpOrCancel}
            onPointerEnter={(e) => handlePointerEnter(e, bk.midi)}
          />
        );
      })}
    </div>
  );
}
