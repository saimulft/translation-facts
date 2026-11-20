import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const cli = new URL('../src/cli.ts', import.meta.url).pathname;
const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'translation-facts-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: fixtures, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

describe('cli', () => {
  it('exits 0 and says so when nothing is wrong', () => {
    const { code, out } = run('en.json', 'fr.json');
    assert.equal(code, 0);
    assert.equal(out, 'fr.json: ok (6 keys checked)\n\nNo problems found.\n');
  });

  it('prints one line per problem and exits 1', () => {
    const { code, out, err } = run('en.json', 'de.json');
    assert.equal(code, 1);
    assert.equal(err, '');
    assert.equal(
      out,
      [
        'de.json: 5 problems',
        '  pricing.standard: changed $49.99 -> 49,99 € (price)',
        '  pricing.discount: missing 20% (percent)',
        '  pricing.contact: changed https://acme.example/pricing -> https://acme.example/preise (url)',
        '  pricing.contact: changed sales@acme.example -> vertrieb@acme.example (email)',
        '  cart.greeting: changed {name} -> {nom} (token)',
        '',
        '5 problems in 1 of 1 file.',
        '',
      ].join('\n'),
    );
  });

  it('checks several targets and names each one', () => {
    const { code, out } = run('en.json', 'de.json', 'fr.json', 'bn-flat.json');
    assert.equal(code, 1);
    assert.match(out, /^de\.json: 5 problems\n/);
    assert.match(out, /\nfr\.json: ok \(6 keys checked\)\n/);
    assert.match(out, /\nbn-flat\.json: ok \(3 keys checked\)\n/);
    assert.match(out, /5 problems in 1 of 3 files\.\n$/);
  });

  it('requires the terms given with --keep', () => {
    const { code, out } = run('en.json', 'de.json', '--keep', 'Acme');
    assert.equal(code, 1);
    assert.match(out, /pricing\.title: missing Acme \(term\)/);
    assert.equal(run('en.json', 'fr.json', '--keep', 'Acme').code, 0);
  });

  it('accepts several terms, comma separated or repeated', () => {
    const file = join(scratch, 'terms.json');
    writeFileSync(file, JSON.stringify({ a: 'Acme Pro Elite' }));
    const target = join(scratch, 'terms-de.json');
    writeFileSync(target, JSON.stringify({ a: 'Elite' }));
    const { out } = run(file, target, '--keep', 'Acme, Pro', '--keep', 'Elite');
    assert.match(out, /a: missing Acme \(term\)/);
    assert.match(out, /a: missing Pro \(term\)/);
    assert.doesNotMatch(out, /Elite \(term\)/);
  });

  it('reports facts the translation adds with --extra', () => {
    const file = join(scratch, 'plain.json');
    writeFileSync(file, JSON.stringify({ a: 'Welcome' }));
    const target = join(scratch, 'plain-de.json');
    writeFileSync(target, JSON.stringify({ a: 'Willkommen, 3 Monate gratis' }));
    assert.equal(run(file, target).code, 0);
    const { code, out } = run(file, target, '--extra');
    assert.equal(code, 1);
    assert.match(out, /a: extra 3 \(number\)/);
  });

  it('prints JSON with --json', () => {
    const { code, out } = run('en.json', 'de.json', 'fr.json', '--json');
    assert.equal(code, 1);
    const data = JSON.parse(out);
    assert.equal(data.ok, false);
    assert.equal(data.source, 'en.json');
    assert.deepEqual(
      data.files.map((f: { file: string; ok: boolean; checked: number }) => [f.file, f.ok, f.checked]),
      [
        ['de.json', false, 6],
        ['fr.json', true, 6],
      ],
    );
    const discount = data.files[0].problems.find((p: { key: string }) => p.key === 'pricing.discount');
    assert.deepEqual(discount.missing, [{ kind: 'percent', value: '20%', key: 'percent:20%' }]);
    assert.deepEqual(discount.changed, []);
    assert.deepEqual(discount.extra, []);
  });

  it('exits 0 with --json when all is well', () => {
    const { code, out } = run('en.json', 'fr.json', '--json');
    assert.equal(code, 0);
    assert.equal(JSON.parse(out).ok, true);
  });

  it('reads flat files and files with native digits against a nested source', () => {
    assert.equal(run('en.json', 'bn-flat.json').code, 0);
  });

  it('prints help and exits 0', () => {
    for (const flag of ['--help', '-h']) {
      const { code, out } = run(flag);
      assert.equal(code, 0);
      assert.match(out, /^Usage: translation-facts <source\.json> <target\.json>/);
      assert.match(out, /--keep/);
      assert.match(out, /--json/);
    }
  });

  it('prints the version', () => {
    const { code, out } = run('--version');
    assert.equal(code, 0);
    assert.match(out, /^\d+\.\d+\.\d+\n$/);
  });

  it('exits 2 with usage when files are missing', () => {
    for (const args of [[], ['en.json']]) {
      const { code, out, err } = run(...args);
      assert.equal(code, 2);
      assert.equal(out, '');
      assert.match(err, /give a source file and at least one target file/);
      assert.match(err, /Usage: translation-facts/);
    }
  });

  it('exits 2 on an unknown option', () => {
    const { code, err } = run('en.json', 'de.json', '--nope');
    assert.equal(code, 2);
    assert.match(err, /Unknown option '--nope'/);
  });

  it('exits 2 on a file that cannot be read', () => {
    const { code, out, err } = run('en.json', 'nowhere.json');
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /translation-facts: cannot read nowhere\.json/);
  });

  it('exits 2 on invalid JSON and on JSON that is not an object', () => {
    const broken = join(scratch, 'broken.json');
    writeFileSync(broken, '{ "a": ');
    const list = join(scratch, 'list.json');
    writeFileSync(list, '["a"]');
    const invalid = run('en.json', broken);
    assert.equal(invalid.code, 2);
    assert.match(invalid.err, /broken\.json is not valid JSON/);
    const notObject = run(list, 'en.json');
    assert.equal(notObject.code, 2);
    assert.match(notObject.err, /list\.json must contain a JSON object/);
  });

  it('accepts a byte order mark', () => {
    const bom = join(scratch, 'bom.json');
    writeFileSync(bom, '\uFEFF{"a": "Pay $5"}');
    assert.equal(run(bom, bom).code, 0);
  });
});
