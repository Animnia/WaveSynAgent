import { useEffect, useRef } from 'react';
import { getAudioEngine } from '@/engine/registry';

interface SpectrumAnalyzerProps {
  width?: number;
  height?: number;
  color?: string;
}

export default function SpectrumAnalyzer({
  width = 300,
  height = 100,
  color = '#27272a',
}: SpectrumAnalyzerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const draw = () => {
      const engine = getAudioEngine();
      const data = engine.getFFTData();

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Use only the first portion (lower frequencies are more interesting)
      const usableLength = Math.floor(data.length * 0.5);
      const barWidth = width / usableLength;

      for (let i = 0; i < usableLength; i++) {
        // FFT data from Tone.js Analyser is in dB (-Infinity to 0)
        const db = data[i] as number;
        const normalized = Math.max(0, (db + 100) / 100); // -100dB to 0dB → 0 to 1
        const barHeight = normalized * height;

        // Gradient from color to darker
        const alpha = 0.4 + normalized * 0.6;
        ctx.fillStyle =
          i % 2 === 0
            ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
            : `${color}${Math.round(alpha * 200).toString(16).padStart(2, '0')}`;

        ctx.fillRect(
          i * barWidth,
          height - barHeight,
          Math.max(barWidth - 0.5, 0.5),
          barHeight,
        );
      }

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="rounded-lg border border-border-default bg-bg-tertiary"
    />
  );
}
