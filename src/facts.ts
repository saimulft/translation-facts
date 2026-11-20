/** The kinds of fact the extractor recognises. */
export type FactKind = 'number' | 'price' | 'percent' | 'url' | 'token' | 'email' | 'term';

/** One fact found in a piece of text. */
export interface Fact {
  /** What sort of fact this is. */
  kind: FactKind;
  /** The fact as written in the text, for example `$49.99` or `{{name}}`. */
  value: string;
  /** The normalised identity used to compare facts across languages, for example `price:$49.99`. */
  key: string;
}

/** Options for {@link extractFacts}. */
export interface ExtractOptions {
  /** Terms that must appear unchanged, such as product names. Matched case-sensitively as whole words. */
  keepTerms?: readonly string[];
}

/** Options for {@link keepTermsFrom}. */
export interface KeepTermsOptions {
  /** Terms longer than this many characters are ignored. Defaults to 60. */
  maxLength?: number;
}

// Digits of other scripts, each string listing the digits 0 to 9 in order.
const NATIVE_DIGITS = [
  '০১২৩৪৫৬৭৮৯', // Bengali
  '๐๑๒๓๔๕๖๗๘๙', // Thai
  '०१२३४५६७८९', // Devanagari
  '٠١٢٣٤٥٦٧٨٩', // Arabic-Indic
  '۰۱۲۳۴۵۶۷۸۹', // Extended Arabic-Indic
];

const DIGIT_VALUES = new Map<string, string>();
for (const set of NATIVE_DIGITS) {
  [...set].forEach((digit, value) => DIGIT_VALUES.set(digit, String(value)));
}
const NATIVE_DIGIT_RE = new RegExp(`[${NATIVE_DIGITS.join('')}]`, 'g');

/**
 * Rewrites Bengali, Thai, Devanagari, Arabic-Indic and Extended Arabic-Indic digits as Latin ones, so that
 * `৭` and `7` are the same fact.
 *
 * @example
 * latinDigits('৫০ টাকা'); // '50 টাকা'
 */
export function latinDigits(text: string): string {
  return text.replace(NATIVE_DIGIT_RE, (digit) => DIGIT_VALUES.get(digit) ?? digit);
}

// What can separate digit groups: dot, comma, space, no-break space, thin space, narrow no-break space.
// Line breaks are not separators, so numbers on neighbouring lines are never joined.
const SEPARATORS = String.raw`.,\x20\u00a0\u2009\u202f`;
const SEPARATOR_RE = new RegExp(`[${SEPARATORS}]`);

/**
 * One number's value without its grouping: `1,000` and `1.000` are 1000, `7.50` and `7,5` are 7.5. A last group
 * of exactly three digits after a separator reads as grouping.
 *
 * @example
 * canonicalNumber('1 234,50'); // '1234.5'
 */
export function canonicalNumber(raw: string): string {
  const groups = raw.split(SEPARATOR_RE).filter(Boolean);
  if (groups.length === 1) return String(Number(groups[0]));
  const last = groups[groups.length - 1];
  const grouped = last.length === 3;
  const whole = grouped ? groups.join('') : groups.slice(0, -1).join('');
  const value = grouped ? whole : `${whole}.${last}`;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

const CURRENCY_SYMBOLS = new Set(['$', '€', '£', '¥', '₹', '৳', '฿', '₫', '₩', '₽', '₺', '₴', '₪', '₱']);
const CURRENCY_CODES: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  INR: '₹',
  BDT: '৳',
  THB: '฿',
  VND: '₫',
  IDR: 'Rp',
};

// The digit and group counts are bounded, like the email pattern: an unbounded run makes these quadratic on a
// long string of digits or letters.
const NUM = String.raw`\d{1,30}(?:[${SEPARATORS}]\d{3}){0,10}(?:[.,]\d{1,30})?`;
const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g;
const TOKEN_RE = /\{\{?\s*[A-Za-z_][\w.]*\s*\}?\}/g;
// A symbol can come before the amount ($7) or after it (7 $, as in fr-CA, de, pl, ru, tr). Symbols only: words
// such as kr or zł are too easily something else.
const SYMBOLS = '$€£¥₹৳฿₫₩₽₺₴₪₱';
const PRICE_RE = new RegExp(
  String.raw`(?:US\s?)?([${SYMBOLS}]|Rp\.?)\s?(${NUM})|(${NUM})\s?(USD|EUR|GBP|JPY|INR|BDT|THB|VND|IDR|[${SYMBOLS}])(?!\d)`,
  'g',
);
const PERCENT_RE = new RegExp(String.raw`(${NUM})\s?%`, 'g');
const NUMBER_RE = new RegExp(String.raw`(?<![\w.])(${NUM})(?![\w])|(?<![\w.])(${NUM})(?=[A-Za-zÀ-￿])`, 'g');
const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/gi;
const MD_LINK_RE = /\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** A URL's identity: host (lower-cased), path without a trailing slash, query and hash. The scheme is ignored. */
function urlKey(url: string): string {
  const trimmed = url.trim().replace(/[).,;:!?]+$/, '');
  try {
    const parsed = new URL(trimmed, 'http://relative.invalid');
    const host = parsed.host === 'relative.invalid' ? '' : parsed.host.toLowerCase();
    return `${host}${parsed.pathname.replace(/\/+$/, '') || '/'}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

/** A price's identity: the currency symbol followed by the canonical amount, so `7 USD` and `$7` match. */
function priceKey(symbol: string, amount: string): string {
  const unit = CURRENCY_SYMBOLS.has(symbol) ? symbol : (CURRENCY_CODES[symbol] ?? symbol.replace(/\.$/, ''));
  return `${unit}${canonicalNumber(amount)}`;
}

/**
 * Reads the terms to keep unchanged from a style guide or glossary: every line of the form
 * `Keep in English: Acme, Free, Elite` (a leading list marker or bold markers are fine). Terms are split on
 * commas and semicolons, parenthesised notes and quote marks are dropped, and duplicates are removed.
 *
 * @example
 * keepTermsFrom('Tone: friendly.\nKeep in English: Acme, Free'); // ['Acme', 'Free']
 */
export function keepTermsFrom(guideline: string | null | undefined, opts: KeepTermsOptions = {}): string[] {
  const maxLength = opts.maxLength ?? 60;
  const terms = new Set<string>();
  for (const line of (guideline ?? '').split(/\r?\n/)) {
    const m = /^\s*[-*]?\s*\**\s*keep in english\s*:?\s*\**\s*:?\s*(.*)$/i.exec(line);
    if (!m) continue;
    for (const part of m[1].split(/[,;]/)) {
      const term = part
        .replace(/\(.*?\)/g, '')
        .replace(/[*.`"]+/g, '')
        .trim();
      if (term && term.length <= maxLength) terms.add(term);
    }
  }
  return [...terms];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Finds the facts in one piece of text: URLs (plain, `href` and Markdown links), email addresses,
 * `{placeholders}`, prices, percentages and plain numbers, plus any `keepTerms` present. HTML tags and entities
 * are ignored. Facts come back in that order of kind, then in order of appearance.
 *
 * @example
 * extractFacts('Pay $49.99 now, 20% off.').map((f) => f.key); // ['price:$49.99', 'percent:20%']
 */
export function extractFacts(raw: string, opts: ExtractOptions = {}): Fact[] {
  const out: Fact[] = [];
  const push = (kind: FactKind, value: string, key: string) => out.push({ kind, value, key: `${kind}:${key}` });
  let text = latinDigits(raw);
  for (const m of text.matchAll(HREF_RE)) push('url', m[1], urlKey(m[1]));
  for (const m of text.matchAll(MD_LINK_RE)) if (!m[1].startsWith('#')) push('url', m[1], urlKey(m[1]));
  text = text
    .replace(HREF_RE, ' ')
    .replace(MD_LINK_RE, '] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');
  for (const m of text.matchAll(URL_RE)) push('url', m[0], urlKey(m[0]));
  text = text.replace(URL_RE, ' ');
  for (const m of text.matchAll(EMAIL_RE)) push('email', m[0], m[0].toLowerCase());
  text = text.replace(EMAIL_RE, ' ');
  for (const m of text.matchAll(TOKEN_RE)) push('token', m[0], m[0].replace(/[{}\s]/g, ''));
  text = text.replace(TOKEN_RE, ' ');
  for (const m of text.matchAll(PRICE_RE)) {
    const symbol = m[1] ?? m[4];
    const amount = m[2] ?? m[3];
    push('price', m[0].trim(), priceKey(symbol, amount));
  }
  text = text.replace(PRICE_RE, ' ');
  for (const m of text.matchAll(PERCENT_RE)) push('percent', m[0].trim(), `${canonicalNumber(m[1])}%`);
  text = text.replace(PERCENT_RE, ' ');
  for (const m of text.matchAll(NUMBER_RE)) {
    const value = (m[1] ?? m[2]).trim();
    push('number', value, canonicalNumber(value));
  }
  for (const term of opts.keepTerms ?? []) {
    if (!term.trim()) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'u');
    if (re.test(raw)) push('term', term, term);
  }
  return out;
}
