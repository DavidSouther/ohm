import test from 'ava';
import {getDuplicates, getDuplicatesSet, isLexical, isSyntactic} from '../src/common.js';

test('rule-name classification preserves Unicode and uncased prefixes', t => {
  for (const name of ['Pair', '_Pair', 'É', 'Ω', 'Ж', '漢', '𐐀', '𐐨']) {
    t.true(isSyntactic(name), `rule ${name}`);
    t.false(isLexical(name), `rule ${name}`);
  }
  for (const name of ['pair', 'é', 'ω', 'ж', 'ǅ']) {
    t.false(isSyntactic(name), `rule ${name}`);
    t.true(isLexical(name), `rule ${name}`);
  }
});

test('duplicate helpers preserve first-occurrence order for short and long lists', t => {
  for (const length of [4, 20, 23, 24, 32]) {
    const unique = Array.from({length}, (_, idx) => `p${idx}`);
    const repeated = ['a', 'b', 'b', 'a', ...unique.slice(4)];
    t.deepEqual(getDuplicates(unique), []);
    t.deepEqual(getDuplicatesSet(unique), new Set());
    t.deepEqual(getDuplicates(repeated), ['a', 'b']);
    t.deepEqual([...getDuplicatesSet(repeated)], ['a', 'b']);
  }
});

test('duplicate helpers preserve NaN, sparse-array and object-identity behavior', t => {
  const shared = {};
  for (const length of [4, 20, 23, 24, 32]) {
    const tail = Array.from({length: length - 4}, (_, idx) => `p${idx}`);
    const values = [NaN, shared, {}, shared, ...tail];
    t.deepEqual(getDuplicates(values), [NaN, shared]);
    t.deepEqual([...getDuplicatesSet(values)], [NaN, shared]);
    t.deepEqual(getDuplicates(Array(length)), [undefined]);
    t.deepEqual([...getDuplicatesSet(Array(length))], [undefined]);
  }
});
