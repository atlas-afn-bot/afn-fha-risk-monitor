/**
 * Left-rail predicate picker for the Scenario Builder (design §5.4).
 *
 * Groups the registry by family and lets the user click to append a
 * predicate to the working scenario with its default params. This is a
 * dumb component — it does not track selected state.
 */
import { groupPredicatesByFamily, type PredicateSpec } from '@/lib/scenarios/registry';

export interface PredicatePickerProps {
  onAdd(predicate: PredicateSpec): void;
  /** Predicate ids already selected — shown with a checkmark badge. */
  selectedIds?: string[];
}

export function PredicatePicker({ onAdd, selectedIds = [] }: PredicatePickerProps): JSX.Element {
  const groups = groupPredicatesByFamily();
  const selected = new Set(selectedIds);
  return (
    <div className="space-y-4" data-testid="predicate-picker">
      <div>
        <h3 className="text-sm font-semibold mb-1">Predicate library</h3>
        <p className="text-[11px] text-muted-foreground">
          Click a predicate to add it to the scenario. All predicates operate on origination-time
          fields only — no delinquency qualifiers (design doc §2).
        </p>
      </div>
      {groups.map((g) => (
        <div key={g.family} className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {g.label}
          </div>
          <ul className="space-y-0.5">
            {g.predicates.map((p) => {
              const isSelected = selected.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onAdd(p)}
                    className="w-full text-left px-2 py-1 text-xs rounded hover:bg-muted flex items-start justify-between gap-2 group"
                    title={p.description}
                    data-testid={`predicate-add-${p.id}`}
                  >
                    <span className="flex-1">
                      <span className="font-medium">{p.label}</span>
                      <span className="block text-[10px] text-muted-foreground leading-tight">
                        {p.description}
                      </span>
                    </span>
                    {isSelected && (
                      <span
                        className="text-[10px] text-risk-green"
                        aria-label="already added"
                        data-testid={`predicate-added-${p.id}`}
                      >
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
