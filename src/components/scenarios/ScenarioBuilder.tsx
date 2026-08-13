/**
 * Scenario Builder form — used by /scenarios/new and /scenarios/:id/edit.
 *
 * Wires:
 *   • PredicatePicker (left rail) → append predicates to the working set.
 *   • Selected predicates panel → param editors, remove.
 *   • composition_op toggle (AND / OR / WEIGHTED per §5.4).
 *   • ScenarioPreview (live evaluate) → subtotals + per-office impact.
 *
 * Save / cancel handlers come from the parent route since /new persists to
 * the local store and /:id/edit updates in place. The builder itself does
 * not know about routing.
 */
import { useState } from 'react';
import { PredicatePicker } from './PredicatePicker';
import { ScenarioPreview } from './ScenarioPreview';
import { getPredicate, type PredicateSpec } from '@/lib/scenarios/registry';
import type { CompositionOp, ScenarioPredicate } from '@/lib/scenarios/types';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export interface ScenarioBuilderProps {
  snapshotMonth: string;
  initial?: {
    name: string;
    description: string;
    predicates: ScenarioPredicate[];
    composition_op: CompositionOp;
  };
  onSave(input: { name: string; description: string; predicates: ScenarioPredicate[]; composition_op: CompositionOp }): void;
  onCancel(): void;
  submitLabel?: string;
  /** Test-only: override the preview debounce (default 500ms). */
  previewDebounceMs?: number;
}

function defaultParamsFor(spec: PredicateSpec): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const p of spec.params) out[p.name] = p.default;
  return out;
}

export function ScenarioBuilder(props: ScenarioBuilderProps): JSX.Element {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [description, setDescription] = useState(props.initial?.description ?? '');
  const [predicates, setPredicates] = useState<ScenarioPredicate[]>(props.initial?.predicates ?? []);
  const [compositionOp, setCompositionOp] = useState<CompositionOp>(props.initial?.composition_op ?? 'AND');

  function handleAdd(spec: PredicateSpec) {
    if (predicates.some((p) => p.predicate_id === spec.id)) return;
    setPredicates((cur) => [...cur, { predicate_id: spec.id, params: defaultParamsFor(spec) }]);
  }

  function handleRemove(idx: number) {
    setPredicates((cur) => cur.filter((_, i) => i !== idx));
  }

  function updateParam(idx: number, name: string, value: number | string | boolean) {
    setPredicates((cur) =>
      cur.map((p, i) => (i === idx ? { ...p, params: { ...p.params, [name]: value } } : p)),
    );
  }

  function updateWeight(idx: number, weight: number) {
    setPredicates((cur) => cur.map((p, i) => (i === idx ? { ...p, weight } : p)));
  }

  const canSave = name.trim().length > 0 && predicates.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_360px] gap-6">
      {/* Left rail — predicate library. */}
      <aside className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <PredicatePicker
          onAdd={handleAdd}
          selectedIds={predicates.map((p) => p.predicate_id)}
        />
      </aside>

      {/* Center — form + composition_op + selected predicates. */}
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="scenario-name" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Scenario name
          </label>
          <input
            id="scenario-name"
            className="w-full text-sm px-3 py-2 border border-border rounded-md bg-background"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tighten Boost origination guidelines"
            data-testid="scenario-name-input"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="scenario-description" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Description (committee summary)
          </label>
          <textarea
            id="scenario-description"
            className="w-full text-sm px-3 py-2 border border-border rounded-md bg-background min-h-[80px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Plain-English committee-facing summary of what this scenario proposes."
            data-testid="scenario-description-input"
          />
        </div>

        {/* composition_op toggle — design §5.4. */}
        <div className="space-y-1" data-testid="composition-op-toggle">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Combine predicates with</div>
          <div className="inline-flex rounded-md border border-border overflow-hidden" role="radiogroup" aria-label="Composition operator">
            {(['AND', 'OR', 'WEIGHTED'] as CompositionOp[]).map((op) => (
              <button
                key={op}
                type="button"
                role="radio"
                aria-checked={compositionOp === op}
                data-testid={`composition-op-${op}`}
                onClick={() => setCompositionOp(op)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  compositionOp === op
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {op}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {compositionOp === 'AND' && 'Intersection — remove loans that match ALL predicates. Tightest slice.'}
            {compositionOp === 'OR' && 'Union — remove loans that match ANY predicate. Widest slice.'}
            {compositionOp === 'WEIGHTED' && 'Union with per-predicate weights (v1: preview treats as OR; weights preserved on save).'}
          </p>
        </div>

        {/* Selected predicates. */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Selected predicates ({predicates.length})
          </div>
          {predicates.length === 0 ? (
            <div
              className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground"
              data-testid="selected-predicates-empty"
            >
              No predicates selected. Click one from the library on the left to add it.
            </div>
          ) : (
            <ul className="space-y-1.5" data-testid="selected-predicates-list">
              {predicates.map((sp, idx) => {
                const spec = getPredicate(sp.predicate_id);
                if (!spec) {
                  return (
                    <li key={idx} className="text-xs text-risk-red">Unknown predicate: {sp.predicate_id}</li>
                  );
                }
                return (
                  <li
                    key={sp.predicate_id}
                    className="border border-border rounded-md px-3 py-2 flex items-center justify-between gap-3 flex-wrap"
                    data-testid={`selected-predicate-${sp.predicate_id}`}
                  >
                    <div className="flex-1 min-w-[180px]">
                      <div className="text-xs font-medium">{spec.label}</div>
                      <div className="text-[10px] text-muted-foreground">{spec.family}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {spec.params.map((param) => {
                        const val = sp.params[param.name] ?? param.default;
                        if (param.type === 'enum' && param.options) {
                          return (
                            <label key={param.name} className="text-[11px] inline-flex items-center gap-1">
                              <span className="text-muted-foreground">{param.name}</span>
                              <select
                                value={String(val)}
                                onChange={(e) => updateParam(idx, param.name, e.target.value)}
                                className="text-xs px-1.5 py-0.5 border border-border rounded bg-background"
                                data-testid={`param-${sp.predicate_id}-${param.name}`}
                              >
                                {param.options.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </label>
                          );
                        }
                        if (param.type === 'bool') {
                          return (
                            <label key={param.name} className="text-[11px] inline-flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={Boolean(val)}
                                onChange={(e) => updateParam(idx, param.name, e.target.checked)}
                                data-testid={`param-${sp.predicate_id}-${param.name}`}
                              />
                              <span className="text-muted-foreground">{param.name}</span>
                            </label>
                          );
                        }
                        return (
                          <label key={param.name} className="text-[11px] inline-flex items-center gap-1">
                            <span className="text-muted-foreground">{param.name}</span>
                            <input
                              type="number"
                              value={String(val)}
                              step={param.type === 'int' ? 1 : 0.1}
                              onChange={(e) => {
                                const v = param.type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
                                if (Number.isFinite(v)) updateParam(idx, param.name, v);
                              }}
                              className="w-20 text-xs px-1.5 py-0.5 border border-border rounded bg-background"
                              data-testid={`param-${sp.predicate_id}-${param.name}`}
                            />
                          </label>
                        );
                      })}
                      {compositionOp === 'WEIGHTED' && (
                        <label className="text-[11px] inline-flex items-center gap-1">
                          <span className="text-muted-foreground">weight</span>
                          <input
                            type="number"
                            step={0.1}
                            defaultValue={sp.weight ?? 1}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (Number.isFinite(v)) updateWeight(idx, v);
                            }}
                            className="w-16 text-xs px-1.5 py-0.5 border border-border rounded bg-background"
                            data-testid={`weight-${sp.predicate_id}`}
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemove(idx)}
                        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-muted text-muted-foreground hover:text-risk-red"
                        aria-label={`Remove ${spec.label}`}
                        data-testid={`remove-predicate-${sp.predicate_id}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Save / cancel. */}
        <div className="flex items-center gap-2 pt-4 border-t border-border">
          <Button
            type="button"
            onClick={() =>
              props.onSave({
                name: name.trim(),
                description: description.trim(),
                predicates,
                composition_op: compositionOp,
              })
            }
            disabled={!canSave}
            data-testid="scenario-save-button"
          >
            {props.submitLabel ?? 'Save scenario'}
          </Button>
          <Button type="button" variant="outline" onClick={props.onCancel} data-testid="scenario-cancel-button">
            Cancel
          </Button>
        </div>
      </div>

      {/* Right rail — live preview. */}
      <aside className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <ScenarioPreview
          snapshotMonth={props.snapshotMonth}
          predicates={predicates.map(({ predicate_id, params }) => ({ predicate_id, params }))}
          compositionOp={compositionOp}
          debounceMs={props.previewDebounceMs}
        />
      </aside>
    </div>
  );
}
