import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newsFor, avoidNow } from '../src/draft/news.js';

test('news flags match names regardless of accents, punctuation and suffixes', () => {
  assert.equal(newsFor({ name: 'Kel’el Ware' }).level, 'avoid');
  assert.equal(newsFor({ name: "Kel'el Ware" }).level, 'avoid');
  assert.equal(newsFor({ name: 'Jaren Jackson Jr.' }).level, 'caution');
  assert.equal(newsFor({ name: 'Jaren Jackson' }).level, 'caution');
  assert.equal(newsFor({ name: 'Nikola Jokić' }), null);
});

test('avoid only applies before okFromRound', () => {
  const ware = { name: "Kel'el Ware" };
  assert.equal(avoidNow(ware, 3), true);
  assert.equal(avoidNow(ware, 10), false);
  assert.equal(avoidNow({ name: 'Jayson Tatum' }, 1), true);
  assert.equal(avoidNow({ name: 'Jayson Tatum' }, 4), false);
  assert.equal(avoidNow({ name: 'Cason Wallace' }, 1), false);
});
