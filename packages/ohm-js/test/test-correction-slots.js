import test from 'ava';
import * as ohm from '../index.mjs';
import * as v18 from '../src/v18.js';

const recover = {recover: true};
const grammar = ohm.grammar(`G {
  Start = Body ! ";"
  Body = "a"
}`);

function slots(g, input, options) {
  const result = g.match(input, undefined, options);
  const semantics = g.createSemantics().addOperation('slots', {
    Start(body, correction, join) {
      return [body, correction, join].map(node => ({
        kind: node.ctorName,
        text: node.sourceString,
        optional: node.isOptional(),
        diagnostic: node.recoveredFailure,
      }));
    },
  });
  return {result, slots: semantics(result).slots()};
}

test('a clean fallible has guarded, absent correction, and actual join slots', t => {
  for (const options of [undefined, recover]) {
    const found = slots(grammar, 'a;', options).slots;
    t.deepEqual(
      found.map(x => x.kind),
      ['Body', '_iter', '_terminal']
    );
    t.deepEqual(
      found.map(x => x.text),
      ['a', '', ';']
    );
    t.true(found[1].optional);
    t.is(found[1].diagnostic, undefined);
  }
});

test('failed guarded input leaves ordinary absence and one correction before the real join', t => {
  const found = slots(grammar, 'x;', recover);
  t.deepEqual(
    found.slots.map(x => x.kind),
    ['_iter', '_correction', '_terminal']
  );
  t.deepEqual(
    found.slots.map(x => x.text),
    ['', 'x', ';']
  );
  t.true(found.slots[0].optional);
  t.is(found.slots[1].diagnostic, found.result.getRecoveredFailures()[0]);
});

test('a matched guarded expression survives a gap before the join', t => {
  const found = slots(grammar, 'a x;', recover);
  t.deepEqual(
    found.slots.map(x => x.text),
    ['a', 'x', ';']
  );
  t.is(found.slots[0].kind, 'Body');
});

test('a guarded repetition retains its matched prefix', t => {
  const g = ohm.grammar('G { Start = "a"* ! ";" }');
  const found = slots(g, 'aa x;', recover);
  t.deepEqual(
    found.slots.map(x => x.text),
    ['aa', 'x', ';']
  );
  t.is(found.result._cst.children[0].children.length, 2);
});

test('a missing join fails and does not synthesize a correction or join', t => {
  const g = ohm.grammar('G { Start = "{" "a"* ! "}" }');
  for (const input of ['{aa', '{aa x']) {
    const result = g.match(input, undefined, recover);
    t.true(result.failed());
    t.true(result.getRecoveredFailures().every(f => !f.missing));
  }
});

test('a failed recovery backtracks without leaking diagnostics', t => {
  const g = ohm.grammar(`G {
    Start = Broken | Good
    Broken = "a"* ! ";"
    Good = "aa x"
  }`);
  const result = g.match('aa x', undefined, recover);
  t.true(result.succeeded());
  t.deepEqual(result.getRecoveredFailures(), []);
});

test('a later terminal failure retains diagnostics in the matched guarded prefix', t => {
  const g = ohm.grammar(`G {
    Start = Item* "z"
    Item = Line* ! "}"
    Line = letter ! ";"
  }`);
  const result = g.match('a x; y } q', undefined, recover);
  t.true(result.failed());
  t.deepEqual(
    result
      .getRecoveredFailures()
      .slice(0, 2)
      .map(f => f.interval.contents),
    ['x', 'y']
  );
});

test('the correction retains diagnostics from a discarded join subtree', t => {
  for (const api of [ohm, v18]) {
    const g = api.grammar(`G {
      Start = "a" ! Join
      Join = Inner "z"
      Inner = letter ! ";"
    }`);
    const result = g.match('a b x; q c;z', undefined, recover);
    t.true(result.succeeded());
    const root = g.createSemantics()(result);
    t.deepEqual(
      root.recoveredFailures.map(f => f.position),
      [4, 7]
    );
    t.deepEqual(root.recoveredFailures, result.getRecoveredFailures());
    t.deepEqual(
      root.child(1).recoveredFailures.map(f => f.position),
      [4, 7]
    );
    t.deepEqual(
      root.child(1)._node.nestedFailures.map(f => f.position),
      [4]
    );
    t.deepEqual(root.child(0).recoveredFailures, []);
    t.deepEqual(root.child(2).recoveredFailures, []);
    t.is(root.child(0).sourceString, 'a');
    t.is(root.child(2).sourceString, 'c;z');
  }
});

test('retained guarded diagnostics remain separate from discarded join diagnostics', t => {
  for (const api of [ohm, v18]) {
    const g = api.grammar(`G {
      Start = Guard ! Join
      Guard = Inner "g"
      Join = Inner "z"
      Inner = letter ! ";"
    }`);
    const result = g.match('a x;g b y; q c;z', undefined, recover);
    t.true(result.succeeded());
    const root = g.createSemantics()(result);
    const failures = root.recoveredFailures;
    t.deepEqual(
      failures.map(f => f.position),
      [2, 8, 11]
    );
    t.deepEqual(
      root.child(0).recoveredFailures.map(f => f.position),
      [2]
    );
    t.deepEqual(
      root.child(1).recoveredFailures.map(f => f.position),
      [8, 11]
    );
    t.deepEqual(
      root.child(1)._node.nestedFailures.map(f => f.position),
      [8]
    );
    t.is(root.child(0).recoveredFailures[0], failures[0]);
    t.is(root.child(1)._node.nestedFailures[0], failures[1]);
    t.is(root.child(1).recoveredFailure, failures[2]);
    root.recoveredFailures.forEach((failure, index) => {
      t.is(failure, result.getRecoveredFailures()[index]);
    });
    t.deepEqual(root.child(2).recoveredFailures, []);
  }
});
