// Run: node --experimental-strip-types --test tests/post-attribution/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaggedUrl, validateTaggedUrl, contentKey, slugify, stripUtm, extractUrls } from '../../edge-functions/_shared/linkedin-utm.ts';

const ID = '6aabdbefa7c75ebb89f400e1';
const key = contentKey('Offer: Decision Context', '2026-11-24T16:00:00.000Z');

test('contentKey is slug-YYYYMMDD (UTC)', () => {
  assert.equal(key, 'offer-decision-context-20261124');
  assert.equal(slugify('  A  B--C '), 'a-b-c');
  assert.throws(() => contentKey('!!!', '2026-11-24'));
  assert.throws(() => contentKey('x', 'nope'));
});

test('build emits the four standard params and validates', () => {
  const u = buildTaggedUrl({ baseUrl: 'https://www.complianceworxs.com/pharma/irr-record', contentKey: key, bufferPostId: ID });
  assert.equal(u, `https://www.complianceworxs.com/pharma/irr-record?utm_source=linkedin&utm_medium=organic_social&utm_campaign=${key}&utm_content=${ID}`);
  const v = validateTaggedUrl(u, { contentKey: key, bufferPostId: ID });
  assert.equal(v.ok, true);
  assert.equal(v.utm.utm_content, ID);
});

test('build replaces legacy utm_* and keeps other params', () => {
  const u = buildTaggedUrl({ baseUrl: 'https://www.complianceworxs.com/sample?ref=x&utm_source=linkedin&utm_medium=organic&utm_campaign=2026_10_irr&utm_content=old_01', contentKey: key, bufferPostId: ID });
  const p = new URL(u).searchParams;
  assert.equal(p.get('ref'), 'x');
  assert.equal(p.getAll('utm_medium').length, 1);
  assert.equal(p.get('utm_medium'), 'organic_social');
  assert.equal(p.get('utm_campaign'), key);
});

test('validator rejects every non-standard shape', () => {
  const ok = (q) => `https://www.complianceworxs.com/sample?${q}`;
  const base = `utm_source=linkedin&utm_medium=organic_social&utm_campaign=${key}&utm_content=${ID}`;
  const bad = {
    'legacy medium': base.replace('organic_social', 'organic'),
    'wrong source': base.replace('=linkedin&', '=linkedin.com&'),
    'campaign without date': base.replace(key, 'offer-decision-context'),
    'campaign uppercase': base.replace(key, 'Offer-20261124'),
    'campaign impossible date': base.replace(key, 'offer-20261340'),
    'content not a buffer id': base.replace(ID, 'offer_batch_release_01'),
    'missing content': base.replace(`&utm_content=${ID}`, ''),
    'duplicate source': base + '&utm_source=x',
    'extra utm_term': base + '&utm_term=x',
  };
  for (const [name, q] of Object.entries(bad)) assert.equal(validateTaggedUrl(ok(q)).ok, false, name);
  assert.equal(validateTaggedUrl('https://buff.ly/5cuHYnh').ok, false);
  assert.equal(validateTaggedUrl('https://evil.example.com/?' + base).ok, false);
  assert.equal(validateTaggedUrl('http://www.complianceworxs.com/?' + base).ok, false);
  assert.equal(validateTaggedUrl('not a url').ok, false);
  assert.equal(validateTaggedUrl(ok(base), { bufferPostId: 'f'.repeat(24) }).ok, false);
});

test('build throws on invalid inputs', () => {
  assert.throws(() => buildTaggedUrl({ baseUrl: 'https://buff.ly/abc', contentKey: key, bufferPostId: ID }));
  assert.throws(() => buildTaggedUrl({ baseUrl: 'https://www.complianceworxs.com/', contentKey: key, bufferPostId: 'short' }));
});

test('stripUtm / extractUrls', () => {
  assert.equal(stripUtm('https://www.complianceworxs.com/a?utm_source=x&b=1'), 'https://www.complianceworxs.com/a?b=1');
  assert.deepEqual(extractUrls('see https://www.complianceworxs.com/a?x=1. and (https://buff.ly/z)'), ['https://www.complianceworxs.com/a?x=1', 'https://buff.ly/z']);
});
