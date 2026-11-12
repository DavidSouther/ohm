import test from 'ava';
import {offset} from '@ohm-js/language';

import {lineIndex, toOffset, toPosition} from './positions.ts';

test('line and character round trip', t => {
  const index = lineIndex('a\nbc');

  t.is(toOffset(index, {line: 1, character: 1}), offset(3));
  t.deepEqual(toPosition(index, 3), {line: 1, character: 1});
});

test('CRLF line endings do not count toward the character', t => {
  const index = lineIndex('ab\r\ncd\r\n');

  t.is(toOffset(index, {line: 1, character: 0}), offset(4));
  t.is(toOffset(index, {line: 0, character: 9}), offset(2));
  t.deepEqual(toPosition(index, 5), {line: 1, character: 1});
});

test('the last line without a newline is addressable to its end', t => {
  const index = lineIndex('a\nbc');

  t.is(toOffset(index, {line: 1, character: 2}), offset(4));
  t.deepEqual(toPosition(index, 4), {line: 1, character: 2});
});

test('positions past a line end or past the last line are clamped', t => {
  const index = lineIndex('a\nbc\n');

  t.is(toOffset(index, {line: 0, character: 7}), offset(1));
  t.is(toOffset(index, {line: 9, character: 0}), offset(5));
  t.deepEqual(toPosition(index, 99), {line: 2, character: 0});
});

test('characters are UTF-16 code units', t => {
  const index = lineIndex('é😀x');

  t.is(toOffset(index, {line: 0, character: 3}), offset(3));
  t.deepEqual(toPosition(index, 4), {line: 0, character: 4});
});
