import { useEffect, useRef } from 'react';
import { getAudioEngine } from '@/engine/registry';

interface OscilloscopeProps {
  width?: number;
  height?: number;
  color?: string;
}

export default function Oscilloscope({
  width = 300,
  height = 100,
  color = '#18181b',
}: OscilloscopeProps) {
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
      const data = engine.getWaveformData();

      // Opaque clear (translucent fill would accumulate on light theme
      // and hide the trace).
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Center reference line
      ctx.strokeStyle = '#e4e4e7';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      // Waveform
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      if (data && data.length > 0) {
        const sliceWidth = width / data.length;
        let x = 0;

        for (let i = 0; i < data.length; i++) {
          const v = (data[i] + 1) / 2;
          const y = v * height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }

        ctx.stroke();
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
