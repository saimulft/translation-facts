import { extractFacts } from './facts.ts';
import type { ExtractOptions, Fact, FactKind } from './facts.ts';

/** Options for {@link compareFacts}. */
export type CompareOptions = ExtractOptions;

/** A fact the translation has in a different form: the source value and what stands in its place. */
export interface ChangedFact {
  /** The kind both facts share. */
  kind: FactKind;
  /** The fact in the source text. */
  from: Fact;
  /** The fact now in the translation. */
  to: Fact;
}

/** The result of {@link compareFacts}. */
export interface FactComparison {
  /** Facts in the source that the translation lacks and nothing replaces. */
  missing: Fact[];
  /** Source facts that the translation replaced with a different fact of the same kind. */
  changed: ChangedFact[];
  /** Facts in the translation that the source lacks and nothing replaced. Never contains kept terms. */
  extra: Fact[];
}

/** Each fact once, by key, in order of first appearance. */
function unique(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => !seen.has(fact.key) && seen.add(fact.key));
}

/**
 * Compares the facts of a source text with those of its translation. A fact counts once however often it
 * appears, so a source that mentions `$7` twice is satisfied by one `$7`. A missing fact and an extra one of the
 * same kind are paired, in order of appearance, into a `changed` entry: `$7` in the source and `$8` in the
 * translation is a change, not a loss plus an addition.
 *
 * @example
 * compareFacts('Only $7 for 2 seats', 'Nur $8 für 2 Plätze');
 * // { missing: [], changed: [{ kind: 'price', from: $7, to: $8 }], extra: [] }
 */
export function compareFacts(source: string, translation: string, opts: CompareOptions = {}): FactComparison {
  const want = unique(extractFacts(source, opts));
  const have = unique(extractFacts(translation, opts));
  const haveKeys = new Set(have.map((fact) => fact.key));
  const wantKeys = new Set(want.map((fact) => fact.key));
  const missing = want.filter((fact) => !haveKeys.has(fact.key));
  // A kept term can only be lost, never added.
  const extra = have.filter((fact) => fact.kind !== 'term' && !wantKeys.has(fact.key));

  const changed: ChangedFact[] = [];
  const lost: Fact[] = [];
  const added = [...extra];
  for (const fact of missing) {
    const at = added.findIndex((other) => other.kind === fact.kind);
    if (at === -1) {
      lost.push(fact);
    } else {
      const [to] = added.splice(at, 1);
      changed.push({ kind: fact.kind, from: fact, to });
    }
  }
  return { missing: lost, changed, extra: added };
}
