import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalNumber, extractFacts, keepTermsFrom, latinDigits } from '../src/index.ts';

const keys = (text: string, keepTerms?: string[]) => extractFacts(text, { keepTerms }).map((f) => f.key);

describe('extractFacts', () => {
  it('finds prices, numbers, percents, tokens, URLs and emails', () => {
    assert.deepEqual(
      keys(
        'Acme Standard is $7 per user a month for 2 members, 10-minute screenshots, 20% off yearly. ' +
          'See https://acme.example/pricing or write to sales@acme.example. Your plan: {plan_price}.',
      ),
      [
        'url:acme.example/pricing',
        'email:sales@acme.example',
        'token:plan_price',
        'price:$7',
        'percent:20%',
        'number:2',
        'number:10',
      ],
    );
  });

  it('returns the value as written next to the normalised key', () => {
    assert.deepEqual(extractFacts('Only 49,99 € today'), [{ kind: 'price', value: '49,99 €', key: 'price:€49.99' }]);
  });

  it('returns nothing for text without facts', () => {
    assert.deepEqual(extractFacts('Hello, world'), []);
    assert.deepEqual(extractFacts(''), []);
  });

  describe('numbers', () => {
    it('reads grouping and decimals the same in every notation', () => {
      assert.deepEqual(keys('1,000 and 1.000 and 1 000 and 1\u00a0000 and 1\u202f000'), Array(5).fill('number:1000'));
      assert.deepEqual(keys('7.50 and 7,5'), ['number:7.5', 'number:7.5']);
      assert.deepEqual(keys('1,234,567.89'), ['number:1234567.89']);
    });

    it('finds numbers glued to units and inside ranges', () => {
      assert.deepEqual(keys('10min, 2x, 3rd'), ['number:10', 'number:2', 'number:3']);
      assert.deepEqual(keys('10-20 items'), ['number:10', 'number:20']);
    });

    it('ignores digits inside words and versions', () => {
      assert.deepEqual(keys('v2 and abc123'), []);
    });

    it('does not join numbers on neighbouring lines', () => {
      assert.deepEqual(keys('Room 101\n202 Elm Street'), ['number:101', 'number:202']);
    });
  });

  describe('prices', () => {
    it('reads a symbol before or after the amount', () => {
      assert.deepEqual(keys('$7'), ['price:$7']);
      assert.deepEqual(keys('€ 7,50'), ['price:€7.5']);
      assert.deepEqual(keys('7,50 €'), ['price:€7.5']);
      assert.deepEqual(keys('£1,299.00'), ['price:£1299']);
    });

    it('reads a trailing symbol the way translations write it', () => {
      assert.deepEqual(keys('49,99 $'), ['price:$49.99']);
      assert.deepEqual(keys('4 980 ¥'), ['price:¥4980']);
      assert.deepEqual(keys('1.299 ₹'), ['price:₹1299']);
      assert.deepEqual(keys('5 000 ₩'), ['price:₩5000']);
      assert.deepEqual(keys('1 500 ₽'), ['price:₽1500']);
      assert.deepEqual(keys('99,90₺'), ['price:₺99.9']);
      assert.deepEqual(keys('250 ₴'), ['price:₴250']);
      assert.deepEqual(keys('30 ₪'), ['price:₪30']);
      assert.deepEqual(keys('500 ₱'), ['price:₱500']);
    });

    it('reads the same price before or after the amount as one fact', () => {
      assert.deepEqual(keys('$49.99'), keys('49,99 $'));
      assert.deepEqual(keys('¥4,980'), keys('4 980 ¥'));
      assert.deepEqual(keys('₩5,000'), keys('5.000₩'));
      assert.deepEqual(keys('₽1500'), keys('1\u00a0500\u00a0₽'));
    });

    it('does not read words for a currency, such as kr or zł, as a symbol', () => {
      assert.deepEqual(keys('49,99 zł'), ['number:49.99']);
      assert.deepEqual(keys('99 kr'), ['number:99']);
    });

    it('does not take a symbol that starts the next price for a trailing one', () => {
      assert.deepEqual(keys('12 $5'), ['price:$5', 'number:12']);
    });

    it('treats a currency code as its symbol', () => {
      assert.deepEqual(keys('7.50 EUR'), keys('€7.50'));
      assert.deepEqual(keys('49 USD'), keys('US$49'));
      assert.deepEqual(keys('5.000 IDR'), keys('Rp 5.000'));
    });

    it('keeps the currency as part of the fact', () => {
      assert.notDeepEqual(keys('$7'), keys('€7'));
    });

    it('does not count a price as a plain number as well', () => {
      assert.deepEqual(keys('Only $7'), ['price:$7']);
    });
  });

  describe('percentages', () => {
    it('allows a space before the sign and a decimal comma', () => {
      assert.deepEqual(keys('20% or 20 %'), ['percent:20%', 'percent:20%']);
      assert.deepEqual(keys('12,5%'), ['percent:12.5%']);
    });
  });

  describe('URLs', () => {
    it('drops trailing punctuation, trailing slashes and the scheme and case of the host', () => {
      assert.deepEqual(keys('Visit https://Acme.example/Docs/, now.'), ['url:acme.example/Docs']);
      assert.deepEqual(keys('http://acme.example/a'), keys('https://acme.example/a/'));
    });

    it('keeps the path, query and hash', () => {
      assert.deepEqual(keys('https://acme.example/a?x=1#top'), ['url:acme.example/a?x=1#top']);
    });

    it('reads href attributes and Markdown links, each once', () => {
      assert.deepEqual(keys('<a href="https://acme.example/a/">go</a>'), ['url:acme.example/a']);
      assert.deepEqual(keys('[docs](https://acme.example/docs "Docs") and [plans](/pricing)'), [
        'url:acme.example/docs',
        'url:/pricing',
      ]);
    });

    it('skips in-page anchors', () => {
      assert.deepEqual(keys('[top](#top)'), []);
    });

    it('does not read digits inside a URL as numbers', () => {
      assert.deepEqual(keys('https://acme.example/v2/item/42'), ['url:acme.example/v2/item/42']);
    });
  });

  describe('emails', () => {
    it('lower-cases the address', () => {
      assert.deepEqual(keys('Mail Sales@Acme.Example.'), ['email:sales@acme.example']);
    });
  });

  describe('placeholders', () => {
    it('reads {name}, {{name}} and spaced or dotted forms by their bare name', () => {
      assert.deepEqual(keys('Hi {name}, {{ user.name }} and {{count}}'), [
        'token:name',
        'token:user.name',
        'token:count',
      ]);
    });

    it('does not read numbered braces or ICU branches as placeholders', () => {
      assert.deepEqual(keys('{0} {count, plural, one {# item} other {# items}}'), ['number:0']);
    });
  });

  describe('native digits', () => {
    it('reads Bengali, Thai, Devanagari, Arabic-Indic and Extended Arabic-Indic digits as Latin ones', () => {
      assert.deepEqual(keys('৭ ডলার'), keys('7 dollars'));
      assert.deepEqual(keys('๑๒๓'), ['number:123']);
      assert.deepEqual(keys('१२३'), ['number:123']);
      assert.deepEqual(keys('٤٥٦'), ['number:456']);
      assert.deepEqual(keys('۷۸۹'), ['number:789']);
    });

    it('reads prices, percents and URLs written with native digits', () => {
      assert.deepEqual(keys('৳৫০০'), ['price:৳500']);
      assert.deepEqual(keys('২০%'), ['percent:20%']);
      assert.deepEqual(keys('https://acme.example/৪২'), ['url:acme.example/42']);
    });

    it('rewrites only the digits', () => {
      assert.equal(latinDigits('৫০ টাকা, ๑ and ٣ and 9'), '50 টাকা, 1 and 3 and 9');
    });
  });

  describe('HTML', () => {
    it('ignores tags and entities', () => {
      assert.deepEqual(keys('<b>5</b>&nbsp;items &amp; more &copy; 2'), ['number:5', 'number:2']);
      assert.deepEqual(keys('<p class="w-10">Hi</p>'), []);
    });
  });

  describe('keep terms', () => {
    it('finds each term that appears, once', () => {
      assert.deepEqual(keys('Acme Elite and Acme again', ['Acme', 'Elite', 'Free']), ['term:Acme', 'term:Elite']);
    });

    it('matches whole words only, case-sensitively', () => {
      assert.deepEqual(keys('Acmeville and acme', ['Acme']), []);
      assert.deepEqual(keys('(Acme), Acme-Corp, Acme!', ['Acme']), ['term:Acme']);
    });

    it('treats letters of any script as part of a word', () => {
      assert.deepEqual(keys('Acmeএর', ['Acme']), []);
      assert.deepEqual(keys('Acme এর', ['Acme']), ['term:Acme']);
    });

    it('escapes regular expression characters in a term', () => {
      assert.deepEqual(keys('Use C++ today', ['C++']), ['term:C++']);
      assert.deepEqual(keys('Use CAA', ['C.A']), []);
    });

    it('ignores empty terms', () => {
      assert.deepEqual(keys('Acme', ['', '  ']), []);
    });
  });

  describe('long input', () => {
    it('stays fast on pathological strings', () => {
      const started = Date.now();
      extractFacts('9'.repeat(200_000));
      extractFacts('1,'.repeat(100_000));
      extractFacts('1 000 '.repeat(50_000));
      extractFacts('a'.repeat(200_000) + '@');
      extractFacts('a@'.repeat(50_000));
      extractFacts('http://'.repeat(30_000));
      extractFacts('{'.repeat(100_000));
      assert.ok(Date.now() - started < 3000, 'extraction took too long');
    });
  });
});

describe('canonicalNumber', () => {
  it('reads grouping and decimal marks the same way', () => {
    assert.equal(canonicalNumber('1,000'), canonicalNumber('1.000'));
    assert.equal(canonicalNumber('7.50'), canonicalNumber('7,5'));
    assert.equal(canonicalNumber('1 234,50'), '1234.5');
    assert.equal(canonicalNumber('007'), '7');
  });

  it('reads a last group of three digits as grouping, even when it is meant as a decimal', () => {
    assert.equal(canonicalNumber('3.141'), '3141');
  });
});

describe('keepTermsFrom', () => {
  it('takes the terms from a "Keep in English" line', () => {
    assert.deepEqual(keepTermsFrom('Tone: friendly.\nKeep in English: Acme, Free, Elite'), ['Acme', 'Free', 'Elite']);
  });

  it('copes with list markers, bold, notes, quotes and semicolons', () => {
    assert.deepEqual(keepTermsFrom('- **Keep in English:** "Acme" (the brand); `Pro`, Acme.'), ['Acme', 'Pro']);
    assert.deepEqual(keepTermsFrom('keep in english Acme'), ['Acme']);
  });

  it('merges several lines and ignores the rest', () => {
    assert.deepEqual(keepTermsFrom('Keep in English: A\r\nTone: warm\r\nKeep in English: B, A'), ['A', 'B']);
  });

  it('drops terms longer than the limit', () => {
    const long = 'x'.repeat(61);
    assert.deepEqual(keepTermsFrom(`Keep in English: Acme, ${long}`), ['Acme']);
    assert.deepEqual(keepTermsFrom(`Keep in English: Acme, ${long}`, { maxLength: 100 }), ['Acme', long]);
  });

  it('returns nothing for missing input', () => {
    assert.deepEqual(keepTermsFrom(null), []);
    assert.deepEqual(keepTermsFrom(undefined), []);
    assert.deepEqual(keepTermsFrom('No terms here'), []);
  });
});
