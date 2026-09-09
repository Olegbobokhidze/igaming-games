import './Meter.css';

export interface MeterProps {
  /** Current value, clamped into [min, max] for display. */
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly label?: string;
  /** Pre-formatted display text; falls back to the raw value. */
  readonly displayValue?: string;
  readonly className?: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Horizontal progress bar for multiplier / round-timer readouts. */
export function Meter({
  value,
  min = 0,
  max = 100,
  label,
  displayValue,
  className,
}: MeterProps) {
  const span = max - min;
  // Guard a degenerate range so the fill never becomes NaN.
  const ratio = span <= 0 ? 0 : clamp((value - min) / span, 0, 1);
  const classes = ['orbit-meter', className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {(label !== undefined || displayValue !== undefined) && (
        <div className="orbit-meter__head">
          {label !== undefined && <span className="orbit-meter__label">{label}</span>}
          {displayValue !== undefined && (
            <span className="orbit-meter__value">{displayValue}</span>
          )}
        </div>
      )}
      <div
        className="orbit-meter__track"
        role="meter"
        aria-label={label ?? 'meter'}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        {...(displayValue !== undefined ? { 'aria-valuetext': displayValue } : {})}
      >
        <div className="orbit-meter__fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
    </div>
  );
}
