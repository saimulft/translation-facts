# translation-facts

Translation quality assurance for the facts in a string: check that the numbers, prices, URLs and placeholders survive translation.

[![npm version](https://img.shields.io/npm/v/translation-facts)](https://www.npmjs.com/package/translation-facts)
[![license](https://img.shields.io/npm/l/translation-facts)](https://www.npmjs.com/package/translation-facts)
[![node version](https://img.shields.io/node/v/translation-facts)](https://www.npmjs.com/package/translation-facts)

Guide, examples and FAQ: https://oss.saimulislam.com/translation-facts/

Extracted from [Sitessa](https://sitessa.com), a headless CMS, where it checks translations before they are saved.

A machine or AI translation can read fine and still change `$49.99` to `$59.99`, drop `20%`, translate `{name}` to `{nom}` or point a link at the wrong page. translation-facts pulls the facts out of each source string (numbers, prices, percentages, URLs, emails, `{placeholders}` and terms you want kept) and checks that every one of them is still in the translation. Tools such as i18next-cli and i18n-check compare keys and placeholders, but not whether the numbers, prices and links inside the text survived.

It has no dependencies and works on JSON message files (flat or nested, i18next and next-intl style) or on single strings.

## Install

```sh
npm install translation-facts
```

Or run it without installing:

```sh
npx translation-facts en.json de.json
```

Node 20 or later. ESM only.

## CLI

```
translation-facts <source.json> <target.json> [more targets...] [--keep term,term] [--extra] [--json]
```

Each target file is compared with the source, key by key. Given this source (`en.json`):

```json
{
  "pricing": {
    "title": "Acme pricing, made simple",
    "standard": "Acme Standard is $49.99 per month for 5 seats.",
    "discount": "Save 20% when you pay yearly.",
    "contact": "Questions? Write to sales@acme.example or visit https://acme.example/pricing."
  },
  "cart": {
    "greeting": "Hello {name}, your order ships in 3 days.",
    "total": "Total: {{amount}}"
  }
}
```

```sh
translation-facts en.json de.json fr.json --keep Acme
```

```
de.json: 6 problems
  pricing.title: missing Acme (term)
  pricing.standard: changed $49.99 -> 49,99 € (price)
  pricing.discount: missing 20% (percent)
  pricing.contact: changed https://acme.example/pricing -> https://acme.example/preise (url)
  pricing.contact: changed sales@acme.example -> vertrieb@acme.example (email)
  cart.greeting: changed {name} -> {nom} (token)
fr.json: ok (6 keys checked)

6 problems in 1 of 2 files.
```

| Option           | Meaning                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `--keep <terms>` | Terms that must appear unchanged, such as product names. Comma separated, can be repeated |
| `--extra`        | Also report facts a translation adds that the source does not have                        |
| `--json`         | Print the result as JSON instead of text                                                  |
| `-v, --version`  | Print the version                                                                         |
| `-h, --help`     | Print the usage                                                                           |

Exit codes: `0` no problems, `1` problems found, `2` usage or file error (missing arguments, unknown option, unreadable file, invalid JSON).

Nested and flat files can be mixed: `pricing.standard` in a flat file is matched with `pricing` / `standard` in a nested one. Keys that are missing or empty in a target are skipped, since that is a question for a key-parity tool.

`--json` prints one object, with the same problems in structured form:

```json
{
  "ok": false,
  "source": "en.json",
  "files": [
    {
      "file": "de.json",
      "ok": false,
      "checked": 6,
      "problems": [
        {
          "key": "pricing.discount",
          "missing": [{ "kind": "percent", "value": "20%", "key": "percent:20%" }],
          "changed": [],
          "extra": []
        }
      ]
    }
  ]
}
```

## API

```ts
import { checkTranslations, compareFacts, extractFacts } from 'translation-facts';
```

### `extractFacts(text, options?)`

Returns the facts in one string, as `{ kind, value, key }`. `value` is the text as written, `key` is the normalised identity used for comparison.

```ts
extractFacts('Pay $49.99 or 49,99 € - 20% off. See https://acme.example/pricing');
// [
//   { kind: 'url', value: 'https://acme.example/pricing', key: 'url:acme.example/pricing' },
//   { kind: 'price', value: '$49.99', key: 'price:$49.99' },
//   { kind: 'price', value: '49,99 €', key: 'price:€49.99' },
//   { kind: 'percent', value: '20%', key: 'percent:20%' },
// ]
```

| Option      | Type       | Meaning                                                                                       |
| ----------- | ---------- | --------------------------------------------------------------------------------------------- |
| `keepTerms` | `string[]` | Terms that must appear unchanged. Matched case-sensitively as whole words, reported as `term` |

### `compareFacts(source, translation, options?)`

Compares the facts of a source string with its translation and returns `{ missing, changed, extra }`.

```ts
compareFacts('Only $7 for 2 seats, save 20%', 'Nur $8 für 2 Plätze');
// {
//   missing: [{ kind: 'percent', value: '20%', key: 'percent:20%' }],
//   changed: [{ kind: 'price', from: { value: '$7', ... }, to: { value: '$8', ... } }],
//   extra: [],
// }
```

| Result    | Meaning                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `missing` | Facts in the source that the translation lacks and nothing replaces                |
| `changed` | A source fact replaced by a different fact of the same kind (`{ kind, from, to }`) |
| `extra`   | Facts only the translation has. Kept terms are never reported here                 |

A fact counts once however often it appears, and order does not matter. A missing fact and an extra fact of the same kind are paired in order of appearance as one `changed` entry. Takes the same options as `extractFacts`.

### `checkTranslations(source, target, options?)`

Checks a whole translation file. Both arguments are plain objects of strings, flat or nested to any depth. Returns `{ ok, checked, problems }`, where each problem is `{ key, missing, changed, extra }`.

```ts
import { readFileSync } from 'node:fs';

const source = JSON.parse(readFileSync('en.json', 'utf8'));
const target = JSON.parse(readFileSync('de.json', 'utf8'));

const { ok, problems } = checkTranslations(source, target, { keepTerms: ['Acme'] });
for (const { key, missing, changed } of problems) {
  console.log(
    key,
    missing.map((f) => f.value),
    changed.map((c) => `${c.from.value} -> ${c.to.value}`),
  );
}
```

| Option        | Type       | Default | Meaning                                           |
| ------------- | ---------- | ------- | ------------------------------------------------- |
| `keepTerms`   | `string[]` | none    | Terms that must appear unchanged                  |
| `reportExtra` | `boolean`  | `false` | Also count facts the translation adds as problems |
| `separator`   | `string`   | `.`     | What joins the parts of a nested key              |

`checked` is the number of keys compared. Keys missing or empty in the target, keys only the target has, and values that are not strings are skipped.

### `flattenMessages(messages, options?)`

Flattens a nested object to a `Map` from key to text (`{ a: { b: 'x' } }` becomes `a.b` to `x`). Arrays are walked by index. Takes `separator`.

### `keepTermsFrom(guideline, options?)`

Reads the terms to keep from a style guide: every line like `Keep in English: Acme, Free, Elite` (a list marker or bold is fine). Pass the result as `keepTerms`. `maxLength` (default `60`) drops longer entries.

```ts
keepTermsFrom('Tone: friendly.\nKeep in English: Acme, Free'); // ['Acme', 'Free']
```

### `canonicalNumber(raw)` and `latinDigits(text)`

The normalisers, exported for reuse. `canonicalNumber('1.000')` and `canonicalNumber('1,000')` are both `'1000'`; `canonicalNumber('7,5')` is `'7.5'`. `latinDigits('৫০')` is `'50'`.

### Types

`Fact`, `FactKind` (`'number' | 'price' | 'percent' | 'url' | 'token' | 'email' | 'term'`), `ExtractOptions`, `KeepTermsOptions`, `CompareOptions`, `ChangedFact`, `FactComparison`, `Messages`, `FlattenOptions`, `CheckOptions`, `KeyProblem` and `CheckResult` are all exported.

## What it recognises

- **Numbers**, in any grouping or decimal notation: `1,000`, `1.000`, `1 000` and `1000` are one fact, and so are `7.50` and `7,5`. Numbers next to units (`10min`, `2x`) and inside ranges (`10-20`) count; digits inside words (`v2`, `abc123`) do not.
- **Native digits**: Bengali, Thai, Devanagari, Arabic-Indic and Extended Arabic-Indic digits are read as Latin ones, so `৭` and `7` match.
- **Prices**: a symbol before the amount (`$ € £ ¥ ₹ ৳ ฿ ₫ ₩ ₽ ₺ ₴ ₪ ₱`, `US$`, `Rp`) or after it (the same symbols, as in `49,99 $` or `4 980 ¥`, and the codes `USD EUR GBP JPY INR BDT THB VND IDR`). Position does not matter and a code matches its symbol, so `$49.99`, `49,99 $` and `49.99 USD` are one fact, as are `7.50 EUR` and `€7.50`. The currency is part of the fact.
- **Percentages**: `20%`, `20 %`, `12,5%`.
- **URLs**: `http(s)://` links, `href` attributes and Markdown links. The scheme, host case, trailing slash and trailing punctuation are ignored; path, query and hash are not. In-page anchors (`#top`) are skipped.
- **Emails**, compared case-insensitively.
- **Placeholders**: `{name}`, `{{name}}`, `{ name }`, `{{ user.name }}`. Compared by bare name, so `{name}` and `{{name}}` are the same fact.
- **Terms to keep**: whatever you pass as `keepTerms`, matched as whole words, case-sensitively, in any script.

HTML tags and entities are ignored, so `<b>5</b>&nbsp;items` has one fact: `5`.

## Limits

- It checks facts, not meaning or grammar. A translation can pass and still be wrong.
- Facts are compared as a set. How often a fact appears and where are not checked.
- A last group of exactly three digits after a separator reads as grouping, so `3.141` is 3141. `1.000` and `1,000` match each other, as intended, but a three-digit decimal is misread.
- Prices are recognised by symbol or ISO code only. Currency words and letter abbreviations (`kr`, `zł`, `円`, `лв`) are not, since they are too easily something else, so `49,99 zł` is read as the number 49.99. A code before the amount (`USD 7`) is also read as the plain number 7.
- Currency conversion shows up as a change, because `$5` and `€5` are different facts.
- Only `{name}` and `{{name}}` style placeholders are recognised. `%s`, `%d`, `{0}`, `$t(...)` and ICU message syntax are not parsed; a simple branch such as `{items}` inside an ICU message is read as a placeholder.
- Dates, times, phone numbers and spelled-out numbers have no special handling. Their digits are read as plain numbers, so a reformatted date (`2026-11-20` to `20.11.2026`) is reported as a problem. Version strings like `1.2.3` read as `1.2`.
- Pairing of `changed` facts is by order within a kind, so with several numbers changed at once the pairs may not be the ones a person would pick.
- The patterns that read digits, emails and URLs are length-bounded to stay linear on hostile input (30 digits in a run, 10 digit groups, 64 characters before the `@` of an email). Longer runs are read in pieces.
- The CLI reads JSON files only. For other formats, parse them yourself and call `checkTranslations`.

## License

MIT © Saimul Islam
