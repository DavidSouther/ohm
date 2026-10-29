import test from 'ava';
import * as ohm from '../index.mjs';
import {emptyEffects} from '../src/RecoveryEffects.js';
import {FailureNode} from '../src/nodes.js';
import {collectRecoveredFailures} from '../src/RecoveredFailure.js';

test('shared effect histories preserve first and last occurrences without expansion', t => {
  const first = {key: 'a', depth: 1};
  const second = {key: 'a', depth: 2};
  let shared = emptyEffects.append(first).append(second);
  for (let i = 0; i < 30; i++) shared = shared.concat(shared);
  const forward = [];
  const reverse = [];
  shared.forEachUnique(value => forward.push(value.depth));
  shared.forEachUnique(value => reverse.push(value.depth), true);
  t.deepEqual(forward, [1, 2]);
  t.deepEqual(reverse, [2, 1]);
  const shifted = [];
  emptyEffects
    .append(first)
    .shift(3)
    .forEachUnique((value, shift) => shifted.push(value.depth + shift));
  t.deepEqual(shifted, [4]);
});

test('materialized nested failures retain writable array identity and mutations', t => {
  const failure = position => ({
    position,
    interval: {startIdx: position, endIdx: position + 1},
    shortMessage: `error ${position}`,
  });
  const nested = failure(1);
  const node = new FailureNode(2, failure(0), emptyEffects.append(nested));
  const values = node.nestedFailures;
  t.is(node.nestedFailures, values);
  const descriptor = Object.getOwnPropertyDescriptor(node, 'nestedFailures');
  t.true(descriptor.enumerable);
  t.true(descriptor.writable);
  values.push(failure(2));
  t.deepEqual(
    collectRecoveredFailures(node).map(value => value.position),
    [0, 1, 2]
  );

  const grammar = ohm.grammar('G { S = "{" Item* ! "}"\n Item = letter ! ";" }');
  const result = grammar.match('{a;1;', undefined, {recover: true});
  t.true(result.succeeded());
  const recovered = result._cst.children[2];
  t.true(recovered.isFailure());
  t.deepEqual(Object.keys(recovered), ['matchLength', 'recoveredFailure', 'nestedFailures']);
  const replacement = [];
  recovered.nestedFailures = replacement;
  t.is(recovered.nestedFailures, replacement);
  t.false(Object.hasOwn(recovered, '_nestedFailureEffects'));
  t.deepEqual(collectRecoveredFailures(recovered), [recovered.recoveredFailure]);
});
