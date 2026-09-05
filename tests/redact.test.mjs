import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/redact.js';
import { originPattern, supportedUrl, validateRules } from '../src/shared.js';
const group = (entity_group, word) => ({ entity_group, word, score: 0.5 });

test('redacts all classified spans, including low-confidence ones, preserving surrounding whitespace', () => {
  const result = redact('Hi Alice Smith, email alice@example.com.\n', [group('O', 'Hi'), group('private_person', ' Alice Smith'), group('O', ', email'), group('private_email', ' alice@example.com'), group('O', '.\n')]);
  assert.deepEqual(result, { text: 'Hi [NAME], email [EMAIL].\n', hidden: 2, characters: 28 });
});
test('exact whitelist applies only to the whole value of its selected category', () => {
  const rule = [{ kind: 'private_person', value: 'Alice' }];
  const result = redact('Alice Alice Smith Alice', [group('private_person', 'Alice'), group('private_person', ' Alice Smith'), group('secret', ' Alice')], rule);
  assert.equal(result.text, 'Alice [NAME] [SECRET]');
  assert.equal(result.hidden, 2);
});
test('whitelist is literal, case sensitive and does not use regex or substring matching', () => {
  assert.equal(redact('alice', [group('private_person', 'alice')], [{ kind: 'private_person', value: 'Alice' }]).text, '[NAME]');
  assert.equal(redact('Alice', [group('private_person', 'Alice')], [{ kind: 'private_person', value: '.*' }]).text, '[NAME]');
});
test('repeated values use sequential full coverage, never first-occurrence search', () => {
  assert.equal(redact('May arrived. May Chen called.', [group('O', 'May arrived.'), group('private_person', ' May Chen'), group('O', ' called.')]).text, 'May arrived. [NAME] called.');
});
test('supports lossless Unicode and counts Unicode code points', () => {
  assert.deepEqual(redact('👋 王丽\r\n', [group('O', '👋'), group('private_person', ' 王丽'), group('O', '\r\n')]), { text: '👋 [NAME]\r\n', hidden: 1, characters: 2 });
});
test('fails closed on gaps, truncation, altered decoding, unknown categories and split Unicode', () => {
  for (const [text, groups] of [
    ['Hi Alice', [group('private_person', 'Alice')]],
    ['Hi Alice', [group('O', 'Hi ')]],
    ['Hello .', [group('O', 'Hello.')]],
    ['Alice', [group('made_up', 'Alice')]],
    ['😀', [group('O', '�'), group('O', '�')]],
    ['anything', []],
  ]) assert.throws(() => redact(text, groups), /ALIGNMENT/);
});
test('whitelist validation rejects malformed values and prototype labels', () => {
  assert.throws(() => validateRules([{ kind: 'constructor', value: 'Alice' }]));
  assert.throws(() => validateRules([{ kind: 'private_person', value: '' }]));
  assert.throws(() => validateRules(Array(101).fill({ kind: 'private_person', value: 'Alice' })));
});
test('site matching uses exact origins and rejects deceptive hosts', () => {
  assert.equal(supportedUrl('https://chatgpt.com/c/1'), true);
  assert.equal(supportedUrl('https://chatgpt.com.evil.example'), false);
  assert.equal(supportedUrl('http://chatgpt.com'), false);
  assert.equal(supportedUrl('http://localhost:8080', ['http://localhost/*']), true);
  assert.equal(originPattern('https://example.com/path?q=1'), 'https://example.com/*');
  assert.throws(() => originPattern('http://example.com'));
});
