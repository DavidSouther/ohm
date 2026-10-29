import test from 'ava';
import {RecoveryAttempts} from '../src/RecoveryAttempts.js';

const attempt = (key, start = 0, rightmost = 10, depth = 1) => ({
  key, start, rightmost, depth,
});

function choose(map, position, permitted) {
  let chosen;
  for (const value of map.values()) {
    if (value.rightmost !== position || permitted.has(value.key)) continue;
    if (!chosen || value.start > chosen.start ||
        (value.start === chosen.start && value.depth > chosen.depth)) chosen = value;
  }
  return chosen;
}

test('attempt selection preserves insertion rank through overwrites and reinsertion', t => {
  const entries = new RecoveryAttempts();
  const permitted = new Map();
  const a = attempt('a');
  const b = attempt('b');
  t.is(entries.set('a', a), entries);
  entries.set('b', b);
  entries.set('a', {...a});
  t.is(entries.choose(10, permitted).key, 'a');
  t.deepEqual([...entries].map(([key]) => key), ['a', 'b']);
  t.true(entries.delete('a'));
  entries.set('a', a);
  t.is(entries.choose(10, permitted), b);
  permitted.set('b', true);
  t.is(entries.choose(10, permitted), a);
  permitted.set('a', true);
  t.is(entries.choose(10, permitted), undefined);
});

test('selection uses only the requested failure position and greatest start then depth', t => {
  const entries = new RecoveryAttempts();
  entries.set('a', attempt('a', 0, 9, 100));
  entries.set('b', attempt('b', 1, 10, 1));
  entries.set('c', attempt('c', 1, 10, 2));
  entries.set('d', attempt('d', 2, 10, 0));
  const permitted = new Map();
  t.is(entries.choose(10, permitted).key, 'd');
  entries.delete('d');
  t.is(entries.choose(10, permitted).key, 'c');
  t.is(entries.choose(9, permitted).key, 'a');
  t.is(entries.choose(8, permitted), undefined);
});

test('overlap retirement includes both boundaries and updates every index', t => {
  const entries = new RecoveryAttempts();
  entries.set('left', attempt('left', 0, 4));
  entries.set('end', attempt('end', 0, 5));
  entries.set('start', attempt('start', 5, 8));
  entries.set('point', attempt('point', 5, 5));
  entries.set('right', attempt('right', 6, 9));
  t.deepEqual(entries.invalidateAt(5).map(value => value.key).sort(), ['end', 'point', 'start']);
  t.deepEqual([...entries].map(([key]) => key), ['left', 'right']);
  t.is(entries.choose(5, new Map()), undefined);
  t.is(entries.size, 2);
  t.false(entries.has('end'));
  t.is(entries.get('left').rightmost, 4);
  t.false(entries.delete('missing'));
  entries.clear();
  t.is(entries.size, 0);
  t.deepEqual([...entries.values()], []);
  t.is(entries.choose(9, new Map()), undefined);
});

test('indexed updates agree with the linear Map policy across mixed operations', t => {
  const entries = new RecoveryAttempts();
  const reference = new Map();
  const permitted = new Map();
  let seed = 1234567;
  const random = n => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let i = 0; i < 3000; i++) {
    const key = `k${random(80)}`;
    const operation = random(5);
    if (operation < 2) {
      const start = random(40);
      const value = attempt(key, start, start + random(20), random(8));
      reference.set(key, value);
      entries.set(key, value);
    } else if (operation === 2) {
      t.is(entries.delete(key), reference.delete(key));
    } else if (operation === 3) {
      const point = random(60);
      for (const [existingKey, value] of reference) {
        if (value.start <= point && value.rightmost >= point) reference.delete(existingKey);
      }
      entries.invalidateAt(point);
    } else if (permitted.has(key)) {
      permitted.delete(key);
    } else {
      permitted.set(key, true);
    }
    t.deepEqual([...entries], [...reference]);
    t.is(entries.size, reference.size);
    const position = random(60);
    t.is(entries.choose(position, permitted), choose(reference, position, permitted));
  }
});

test('ordered inserts and repeated overwrites retain only live balanced index nodes', t => {
  const entries = new RecoveryAttempts();
  const count = 2048;
  const nodeCount = root => {
    const stack = [root];
    let size = 0;
    while (stack.length) {
      const node = stack.pop();
      if (node) {
        size++;
        stack.push(node.left, node.right);
      }
    }
    return size;
  };
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < count; i++) {
      const key = `k${i}`;
      const start = (i * (2 * round + 1)) % count;
      entries.set(key, attempt(key, start, start + 7, i % 5));
    }
    t.is(nodeCount(entries._byFailure), count);
    t.is(nodeCount(entries._byStart), count);
    t.true(entries._byFailure.height < 2 * Math.log2(count + 1));
    t.true(entries._byStart.height < 2 * Math.log2(count + 1));
  }
  const removed = entries.invalidateAt(count / 2);
  t.is(removed.length, 8);
  t.true(removed.every(value => value.start <= count / 2 && value.rightmost >= count / 2));
  t.is(nodeCount(entries._byFailure), count - removed.length);
  t.is(nodeCount(entries._byStart), count - removed.length);
  t.is(entries._byStart.maxRightmost,
    Math.max(...[...entries.values()].map(value => value.rightmost)));
});
