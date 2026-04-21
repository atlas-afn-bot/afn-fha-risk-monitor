import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface SliderWithInputProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
  sliderClassName?: string;
  inputClassName?: string;
  labelClassName?: string;
  className?: string;
}

/**
 * Combined range slider + number input that stay in sync.
 * - Slider gives quick coarse control.
 * - Number input allows precise keyboard entry.
 * - Number input clamps to [min, max] on commit (blur / Enter).
 */
export default function SliderWithInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  sliderClassName,
  inputClassName,
  labelClassName,
  className,
}: SliderWithInputProps) {
  // Local draft string so users can type freely (including empty / partial values)
  // without the committed value jumping around mid-edit.
  const [draft, setDraft] = useState<string>(String(value));

  // Keep the draft in sync when the parent value changes (e.g. slider moves).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const commitDraft = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(Math.round(parsed / step) * step);
    if (next !== value) {
      onChange(next);
    }
    setDraft(String(next));
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label && (
        <label className={cn('text-xs text-muted-foreground', labelClassName)}>
          {label}
        </label>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={cn('w-24', sliderClassName)}
      />
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        className={cn('h-7 w-16 px-2 text-xs', inputClassName)}
      />
    </div>
  );
}
