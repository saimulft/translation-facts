import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareFacts } from '../src/index.ts';

const values = (facts: { value: string }[]) => facts.map((f) => f.value);

describe('compareFacts', () => {
  it('finds nothing when every fact survives, in any notation', () => {
    const source = 'From $7 a month for 2 members. Details: [plans](https://acme.example/pricing).';
    const translation = 'Mulai $7 per bulan untuk ২ anggota. Detail: [paket](https://acme.example/pricing).';
    assert.deepEqual(compareFacts(source, translation, { keepTerms: ['Acme'] }), {
      missing: [],
      changed: [],
      extra: [],
    });
  });

  it('reports a fact that is gone as missing', () => {
    const result = compareFacts('Save 20% on 2 plans', 'Sparen Sie bei 2 Plänen');
    assert.deepEqual(values(result.missing), ['20%']);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.extra, []);
  });

  it('reports a fact replaced by one of its kind as changed', () => {
    const result = compareFacts('Only $7 for 2 seats', 'Nur $8 für 2 Plätze');
    assert.equal(result.missing.length, 0);
    assert.equal(result.extra.length, 0);
    assert.equal(result.changed.length, 1);
    assert.equal(result.changed[0].kind, 'price');
    assert.equal(result.changed[0].from.value, '$7');
    assert.equal(result.changed[0].to.value, '$8');
  });

  it('reports a currency swap, a translated placeholder and a new link as changes', () => {
    const result = compareFacts(
      'Pay $5, {name}: https://acme.example/a',
      'Zahlen Sie 5 €, {nom}: https://acme.example/b',
    );
    assert.deepEqual(
      result.changed.map((c) => [c.kind, c.from.value, c.to.value]),
      [
        ['url', 'https://acme.example/a', 'https://acme.example/b'],
        ['token', '{name}', '{nom}'],
        ['price', '$5', '5 €'],
      ],
    );
  });

  it('pairs missing and extra facts of a kind in order of appearance', () => {
    const result = compareFacts('1 or 2 or 3', '1 or 8 or 9 or 10');
    assert.deepEqual(
      result.changed.map((c) => [c.from.value, c.to.value]),
      [
        ['2', '8'],
        ['3', '9'],
      ],
    );
    assert.deepEqual(values(result.extra), ['10']);
  });

  it('reports a fact only the translation has as extra', () => {
    const result = compareFacts('Welcome', 'Willkommen, 3 Monate gratis');
    assert.deepEqual(values(result.extra), ['3']);
    assert.deepEqual(result.missing, []);
  });

  it('counts a fact once however often it appears', () => {
    assert.deepEqual(compareFacts('$7 now, $7 later', 'Jetzt $7'), { missing: [], changed: [], extra: [] });
    assert.deepEqual(values(compareFacts('a 5 b 5', 'x').missing), ['5']);
  });

  it('treats a price with the symbol after the amount as the same price', () => {
    assert.deepEqual(compareFacts('Only $49.99 a month', 'Seulement 49,99 $ par mois'), {
      missing: [],
      changed: [],
      extra: [],
    });
    assert.deepEqual(compareFacts('Only ¥4,980', 'Nur 4 980 ¥'), { missing: [], changed: [], extra: [] });
  });

  it('still reports a different currency as changed, whichever side the symbol is on', () => {
    const result = compareFacts('Only $49.99', 'Nur 49,99 €');
    assert.deepEqual(
      result.changed.map((c) => [c.from.value, c.to.value]),
      [['$49.99', '49,99 €']],
    );
  });

  it('treats native digits and grouping as the same fact', () => {
    assert.deepEqual(compareFacts('৭ ডলার, 1,000 users', '7 dollars, 1.000 users'), {
      missing: [],
      changed: [],
      extra: [],
    });
  });

  it('requires kept terms, and never reports one as extra or changed', () => {
    const lost = compareFacts('Try Acme Elite', 'Probieren Sie Elite', { keepTerms: ['Acme', 'Elite'] });
    assert.deepEqual(values(lost.missing), ['Acme']);
    assert.deepEqual(lost.changed, []);
    const added = compareFacts('Try it', 'Probieren Sie Acme', { keepTerms: ['Acme'] });
    assert.deepEqual(added, { missing: [], changed: [], extra: [] });
  });

  it('does not require terms unless asked', () => {
    assert.deepEqual(compareFacts('Try Acme', 'Probieren Sie es'), { missing: [], changed: [], extra: [] });
  });
});
