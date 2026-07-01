import type { ProjectionScenario } from '@/types/snapshot';
import { cn } from '@/lib/utils';

/**
 * The universal "PROJ" chip that appears next to any projected number.
 * Dashed outline reinforces the "not realized yet" visual language spelled
 * out in ATHENA's Design v1 spec (§5 Visual style).
 */
interface ProjBadgeProps {
  scenario?: ProjectionScenario;
  className?: string;
  tone?: 'neutral' | 'watch' | 'breach';
  /** Suffix like "150↑" or "200↑" to indicate a crossing. */
  suffix?: string;
}

export function ProjBadge({ scenario, className, tone = 'neutral', suffix }: ProjBadgeProps) {
  const toneClass =
    tone === 'breach'
      ? 'border-risk-red/60 text-risk-red'
      : tone === 'watch'
      ? 'border-risk-yellow/60 text-risk-yellow'
      : 'border-muted-foreground/40 text-muted-foreground';

  const scenarioSuffix =
    scenario === 'worst' ? ' · WORST +10%' :
    scenario === 'best'  ? ' · BEST −10%' :
    scenario === 'base'  ? '' : '';

  const label = `PROJ${suffix ? ` ${suffix}` : ''}${scenarioSuffix}`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-dashed text-[9px] font-semibold tracking-wider uppercase leading-none',
        toneClass,
        className,
      )}
      style={{ borderStyle: 'dashed' }}
    >
      {label}
    </span>
  );
}
