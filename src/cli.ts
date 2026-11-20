#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkTranslations } from './check.ts';
import type { CheckResult, KeyProblem, Messages } from './check.ts';

const USAGE = `Usage: translation-facts <source.json> <target.json> [more targets...] [options]

Checks that the numbers, prices, percentages, URLs, emails and {placeholders}
of each source text survive in the same key of every target file.

Options:
  --keep <terms>   Terms that must appear unchanged, comma separated (repeatable)
  --extra          Also report facts a translation adds that the source lacks
  --json           Print the result as JSON
  -v, --version    Print the version
  -h, --help       Print this help

Exit codes: 0 no problems, 1 problems found, 2 usage or file error.
`;

/** A usage or input error: reported on stderr with exit code 2. */
class UsageError extends Error {}

function readMessages(file: string): Messages {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new UsageError(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new UsageError(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new UsageError(`${file} must contain a JSON object of messages`);
  }
  return data as Messages;
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One `key: missing $49.99 (price)` line per problem fact. */
function problemLines(problem: KeyProblem): string[] {
  return [
    ...problem.missing.map((f) => `${problem.key}: missing ${f.value} (${f.kind})`),
    ...problem.changed.map((c) => `${problem.key}: changed ${c.from.value} -> ${c.to.value} (${c.kind})`),
    ...problem.extra.map((f) => `${problem.key}: extra ${f.value} (${f.kind})`),
  ];
}

function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        keep: { type: 'string', multiple: true },
        extra: { type: 'boolean' },
        json: { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    process.stderr.write(`translation-facts: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (positionals.length < 2) {
    process.stderr.write(`translation-facts: give a source file and at least one target file\n\n${USAGE}`);
    return 2;
  }

  const [sourceFile, ...targetFiles] = positionals;
  const keepTerms = (values.keep ?? []).flatMap((list) => list.split(',')).map((term) => term.trim());
  const results: { file: string; result: CheckResult }[] = [];
  try {
    const source = readMessages(sourceFile);
    for (const file of targetFiles) {
      results.push({
        file,
        result: checkTranslations(source, readMessages(file), { keepTerms, reportExtra: values.extra }),
      });
    }
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`translation-facts: ${error.message}\n`);
    return 2;
  }

  const ok = results.every(({ result }) => result.ok);
  if (values.json) {
    const files = results.map(({ file, result }) => ({ file, ...result }));
    process.stdout.write(`${JSON.stringify({ ok, source: sourceFile, files }, null, 2)}\n`);
    return ok ? 0 : 1;
  }

  const lines: string[] = [];
  let total = 0;
  let failing = 0;
  for (const { file, result } of results) {
    if (result.ok) {
      lines.push(`${file}: ok (${plural(result.checked, 'key')} checked)`);
      continue;
    }
    const found = result.problems.flatMap(problemLines);
    total += found.length;
    failing++;
    lines.push(`${file}: ${plural(found.length, 'problem')}`, ...found.map((line) => `  ${line}`));
  }
  lines.push(
    '',
    ok ? 'No problems found.' : `${plural(total, 'problem')} in ${failing} of ${plural(results.length, 'file')}.`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
  return ok ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
