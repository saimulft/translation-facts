import { compareFacts } from './compare.ts';
import type { ChangedFact, CompareOptions } from './compare.ts';
import type { Fact } from './facts.ts';

/**
 * A translation file's content: an object of strings, nested to any depth (i18next and next-intl style), or
 * flat. Arrays inside are walked by index; values that are not strings are ignored.
 */
export type Messages = Readonly<Record<string, unknown>>;

/** Options for {@link flattenMessages}. */
export interface FlattenOptions {
  /** What joins the parts of a nested key. Defaults to `.`. */
  separator?: string;
}

/** Options for {@link checkTranslations}. */
export interface CheckOptions extends CompareOptions, FlattenOptions {
  /**
   * Also report facts the translation adds that the source lacks. Defaults to false, since a translation may
   * reasonably word things differently; a fact replaced by another of its kind is reported as changed either way.
   */
  reportExtra?: boolean;
}

/** What is wrong with one translated key. */
export interface KeyProblem {
  /** The key, with nested parts joined by the separator, for example `checkout.total`. */
  key: string;
  /** Source facts the translation lacks. */
  missing: Fact[];
  /** Source facts the translation replaced with another of the same kind. */
  changed: ChangedFact[];
  /** Facts only the translation has. Empty unless `reportExtra` is set. */
  extra: Fact[];
}

/** The result of {@link checkTranslations}. */
export interface CheckResult {
  /** True when no key has a problem. */
  ok: boolean;
  /** How many keys were compared: those with a non-empty text in both the source and the target. */
  checked: number;
  /** The keys with problems, in source order. */
  problems: KeyProblem[];
}

/**
 * Flattens a nested messages object to a map from key to text, joining nested keys with a separator. Only
 * string values are kept; arrays are walked by index (`items.0`).
 *
 * @example
 * flattenMessages({ cart: { total: 'Total: $5' } }); // Map { 'cart.total' => 'Total: $5' }
 */
export function flattenMessages(messages: Messages, opts: FlattenOptions = {}): Map<string, string> {
  const separator = opts.separator ?? '.';
  const out = new Map<string, string>();
  // An explicit stack instead of recursion, so a deeply nested file cannot overflow the call stack.
  const stack: [string, unknown][] = [['', messages]];
  while (stack.length) {
    const [prefix, value] = stack.pop() as [string, unknown];
    if (typeof value === 'string') {
      out.set(prefix, value);
    } else if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [name, child] = entries[i];
        stack.push([prefix === '' ? name : `${prefix}${separator}${name}`, child]);
      }
    }
  }
  return out;
}

/**
 * Checks every key of a translation against the same key in the source: the numbers, prices, percentages,
 * URLs, emails and placeholders of the source text must come through. Keys missing from the target, or with
 * an empty text, are skipped, as are keys only the target has. Use a key-parity tool for those.
 *
 * @example
 * const result = checkTranslations({ total: 'Total: $49.99' }, { total: 'Gesamt: 49,99 €' });
 * result.problems[0].key; // 'total'
 */
export function checkTranslations(source: Messages, target: Messages, opts: CheckOptions = {}): CheckResult {
  const from = flattenMessages(source, opts);
  const to = flattenMessages(target, opts);
  const problems: KeyProblem[] = [];
  let checked = 0;
  for (const [key, text] of from) {
    const translated = to.get(key);
    if (translated === undefined || translated.trim() === '' || text.trim() === '') continue;
    checked++;
    const { missing, changed, extra } = compareFacts(text, translated, opts);
    const reported = opts.reportExtra ? extra : [];
    if (missing.length || changed.length || reported.length) {
      problems.push({ key, missing, changed, extra: reported });
    }
  }
  return { ok: problems.length === 0, checked, problems };
}
