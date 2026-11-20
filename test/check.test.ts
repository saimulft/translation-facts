import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkTranslations, flattenMessages } from '../src/index.ts';

describe('flattenMessages', () => {
  it('joins nested keys with a dot, in order', () => {
    const flat = flattenMessages({ a: { b: 'x', c: { d: 'y' } }, e: 'z' });
    assert.deepEqual(
      [...flat],
      [
        ['a.b', 'x'],
        ['a.c.d', 'y'],
        ['e', 'z'],
      ],
    );
  });

  it('keeps flat keys as they are, dots included', () => {
    assert.deepEqual(
      [...flattenMessages({ 'a.b': 'x', c: 'y' })],
      [
        ['a.b', 'x'],
        ['c', 'y'],
      ],
    );
  });

  it('walks arrays by index and ignores values that are not strings', () => {
    const flat = flattenMessages({ list: ['one', { name: 'two' }], n: 5, ok: true, none: null });
    assert.deepEqual(
      [...flat],
      [
        ['list.0', 'one'],
        ['list.1.name', 'two'],
      ],
    );
  });

  it('uses the separator it is given', () => {
    assert.deepEqual([...flattenMessages({ a: { b: 'x' } }, { separator: '/' }).keys()], ['a/b']);
  });

  it('handles a key named __proto__ and very deep nesting', () => {
    const flat = flattenMessages(JSON.parse('{"__proto__": {"x": "y"}}'));
    assert.deepEqual([...flat], [['__proto__.x', 'y']]);
    let deep: Record<string, unknown> = { leaf: 'end' };
    for (let i = 0; i < 20_000; i++) deep = { k: deep };
    assert.equal(flattenMessages(deep).size, 1);
  });
});

const source = {
  pricing: {
    standard: 'Standard is $49.99 a month for 5 seats.',
    discount: 'Save 20% when you pay yearly.',
    contact: 'Write to sales@acme.example or visit https://acme.example/pricing.',
  },
  cart: { greeting: 'Hello {name}, it ships in 3 days.', total: 'Total: {{amount}}' },
};

describe('checkTranslations', () => {
  it('passes a faithful translation', () => {
    const target = {
      pricing: {
        standard: 'Standard kostet 49,99 USD pro Monat für ৫ Plätze.',
        discount: 'Sparen Sie 20 % bei jährlicher Zahlung.',
        contact: 'Schreiben Sie an sales@acme.example oder besuchen Sie https://acme.example/pricing/.',
      },
      cart: { greeting: 'Hallo {name}, Versand in 3 Tagen.', total: 'Gesamt: {{amount}}' },
    };
    assert.deepEqual(checkTranslations(source, target), { ok: true, checked: 5, problems: [] });
  });

  it('reports per key what went missing or changed, in nested JSON', () => {
    const target = {
      pricing: {
        standard: 'Standard kostet 59,99 USD pro Monat für 5 Plätze.',
        discount: 'Sparen Sie bei jährlicher Zahlung.',
        contact: 'Schreiben Sie an sales@acme.example.',
      },
      cart: { greeting: 'Hallo {nom}, Versand in 3 Tagen.', total: 'Gesamt: {{amount}}' },
    };
    const result = checkTranslations(source, target);
    assert.equal(result.ok, false);
    assert.equal(result.checked, 5);
    assert.deepEqual(
      result.problems.map((p) => ({
        key: p.key,
        missing: p.missing.map((f) => f.value),
        changed: p.changed.map((c) => `${c.from.value}>${c.to.value}`),
      })),
      [
        { key: 'pricing.standard', missing: [], changed: ['$49.99>59,99 USD'] },
        { key: 'pricing.discount', missing: ['20%'], changed: [] },
        { key: 'pricing.contact', missing: ['https://acme.example/pricing'], changed: [] },
        { key: 'cart.greeting', missing: [], changed: ['{name}>{nom}'] },
      ],
    );
  });

  it('matches flat keys against nested ones', () => {
    const flat = { 'pricing.discount': 'Sparen Sie.', 'cart.total': 'Gesamt: {{amount}}' };
    const result = checkTranslations(source, flat);
    assert.deepEqual(
      result.problems.map((p) => p.key),
      ['pricing.discount'],
    );
    assert.equal(result.checked, 2);
  });

  it('skips keys that are missing, empty or not text in the target, and keys only the target has', () => {
    const target = {
      pricing: { standard: '', discount: '   ', contact: 5 },
      cart: { total: 'x {{amount}}' },
      extra: '9 new',
    };
    assert.deepEqual(checkTranslations(source, target), { ok: true, checked: 1, problems: [] });
  });

  it('skips source keys without text', () => {
    assert.deepEqual(checkTranslations({ a: '', b: 7 }, { a: '5', b: '5' }), { ok: true, checked: 0, problems: [] });
  });

  it('requires the keep terms', () => {
    const result = checkTranslations({ title: 'Acme pricing' }, { title: 'Preise' }, { keepTerms: ['Acme'] });
    assert.deepEqual(
      result.problems.map((p) => [p.key, p.missing.map((f) => f.key)]),
      [['title', ['term:Acme']]],
    );
    assert.equal(checkTranslations({ title: 'Acme pricing' }, { title: 'Preise' }).ok, true);
  });

  it('reports added facts only when asked', () => {
    const quiet = checkTranslations({ a: 'Welcome' }, { a: 'Willkommen, 3 Monate gratis' });
    assert.equal(quiet.ok, true);
    const loud = checkTranslations({ a: 'Welcome' }, { a: 'Willkommen, 3 Monate gratis' }, { reportExtra: true });
    assert.equal(loud.ok, false);
    assert.deepEqual(
      loud.problems[0].extra.map((f) => f.value),
      ['3'],
    );
  });

  it('uses the key separator it is given', () => {
    const result = checkTranslations({ a: { b: 'Pay $5' } }, { 'a/b': 'Zahlen' }, { separator: '/' });
    assert.deepEqual(
      result.problems.map((p) => p.key),
      ['a/b'],
    );
  });
});
