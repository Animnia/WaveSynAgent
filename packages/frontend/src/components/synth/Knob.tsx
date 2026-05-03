import { useCallback, useRef, useState, useEffect } from 'react';

interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  size?: number;
  label?: string;
  unit?: string;
  color?: string;
  onChange: (value: number) => void;
  /** Format function for display value */
  format?: (value: number) => string;
}

const ANGLE_RANGE = 270; // degrees
const START_ANGLE = (360 - ANGLE_RANGE) / 2 + 90; // start from bottom-left

export default function Knob({
  value,
  min,
  max,
  step = 0.01,
  size = 56,
  label,
  unit,
  color = 'var(--color-accent-cyan)',
  onChange,
  format,
}: KnobProps) {
  const knobRef = useRef<SVGSVGElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartValue = useRef(0);

  const normalized = (value - min) / (max - min);
  const angle = START_ANGLE + normalized * ANGLE_RANGE;

  const displayValue = format
    ? format(value)
    : step >= 1
      ? Math.round(value).toString()
      : value.toFixed(step < 0.1 ? 2 : 1);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartY.current = e.clientY;
      dragStartValue.current = value;
    },
    [value],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartY.current - e.clientY;
      const sensitivity = e.shiftKey ? 0.001 : 0.005;
      const range = max - min;
      let newValue = dragStartValue.current + deltaY * sensitivity * range;
      newValue = Math.round(newValue / step) * step;
      newValue = Math.max(min, Math.min(max, newValue));
      onChange(newValue);
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, min, max, step, onChange]);

  // Double-click to reset to center
  const handleDoubleClick = useCallback(() => {
    const center = (min + max) / 2;
    onChange(Math.round(center / step) * step);
  }, [min, max, step, onChange]);

  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;

  // Arc path
  const startRad = ((START_ANGLE - 90) * Math.PI) / 180;
  const endRad = ((angle - 90) * Math.PI) / 180;
  const trackEndRad = ((START_ANGLE + ANGLE_RANGE - 90) * Math.PI) / 180;

  const arcPath = (startA: number, endA: number, radius: number) => {
    const x1 = cx + radius * Math.cos(startA);
    const y1 = cy + radius * Math.sin(startA);
    const x2 = cx + radius * Math.cos(endA);
    const y2 = cy + radius * Math.sin(endA);
    const largeArc = endA - startA > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  // Indicator line
  const indicatorRad = ((angle - 90) * Math.PI) / 180;
  const indR1 = r - 8;
  const indR2 = r - 2;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg
        ref={knobRef}
        width={size}
        height={size}
        className={`cursor-grab ${isDragging ? 'cursor-grabbing' : ''}`}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        {/* Background circle */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="var(--color-bg-tertiary)"
          stroke="var(--color-border-default)"
          strokeWidth={1.5}
        />

        {/* Track arc (background) */}
        <path
          d={arcPath(startRad, trackEndRad, r - 5)}
          fill="none"
          stroke="var(--color-knob-track)"
          strokeWidth={3}
          strokeLinecap="round"
        />

        {/* Value arc */}
        {normalized > 0.005 && (
          <path
            d={arcPath(startRad, endRad, r - 5)}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            style={{
              filter: isDragging ? `drop-shadow(0 0 4px ${color})` : undefined,
            }}
          />
        )}

        {/* Indicator line */}
        <line
          x1={cx + indR1 * Math.cos(indicatorRad)}
          y1={cy + indR1 * Math.sin(indicatorRad)}
          x2={cx + indR2 * Math.cos(indicatorRad)}
          y2={cy + indR2 * Math.sin(indicatorRad)}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>

      {/* Value display */}
      <span className="text-[10px] text-text-secondary font-mono tabular-nums">
        {displayValue}
        {unit && <span className="text-text-muted ml-0.5">{unit}</span>}
      </span>

      {/* Label */}
      {label && (
        <span className="text-[10px] text-text-muted uppercase tracking-wider">
          {label}
        </span>
      )}
    </div>
  );
}
