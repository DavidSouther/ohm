/**
 * Invariants of the Fallible (`B ! C`) operator, from design.md
 * ("Invariants the evaluators must respect"), plus the row based iteration
 * mode used by `ohm-js/v18`. The acceptance test in
 * test-fallible-acceptance.js covers the user facing behavior.
 */

import test from 'ava';
import * as ohm from '../index.mjs';
import * as v18 from '../src/v18.js';

const RECOVER = {recover: true};

const STMTS = String.raw`
Stmts {
  Block = "{" Stmt* ! &"}" "}"
  Stmt  = Body ! ";"
  Body  = ident
  ident = letter+
}`;

const PLAIN_STMTS = STMTS.replace('Stmt* ! &"}"', 'Stmt* &"}"').replace('Body ! ";"', 'Body ";"');

function kinds(node) {
  return node.children.map(c => c.ctorName);
}

function messages(result) {
  return result.getRecoveredFailures().map(f => f.shortMessage);
}

// --------------------------------------------------------------------
// 1. Bindings: two slots, recovered or not
// --------------------------------------------------------------------

test('a fallible always contributes two bindings', t => {
  const g = ohm.grammar(STMTS);
  t.is(g.rules.Stmt.body.getArity(), 2);
  t.is(g.rules.Block.body.getArity(), 4);

  const clean = g.match('{ a; b; }', undefined, RECOVER);
  t.deepEqual(kinds(clean._cst), ['_terminal', '_iter', '_terminal', '_terminal']);
  t.deepEqual(kinds(clean._cst.children[1].children[0]), ['Body', '_terminal']);

  const recovered = g.match('{ a; b b; c }', undefined, RECOVER);
  t.true(recovered.succeeded());
  t.deepEqual(kinds(recovered._cst), ['_terminal', '_iter', '_fail', '_terminal']);
  const [a, bb] = recovered._cst.children[1].children;
  t.deepEqual(kinds(a), ['Body', '_terminal']);
  t.deepEqual(kinds(bb), ['_fail', '_fail']);
  t.is(bb.children[0].matchLength, 0, 'the guarded slot holds an empty placeholder');
  t.is(bb.children[0].recoveredFailure, undefined);
  t.truthy(bb.children[1].recoveredFailure);
});

test('a guarded `?` keeps nothing', t => {
  const g = ohm.grammar(String.raw`
    G {
      Start = Item*
      Item = Opt? ! ";"
      Opt = "a" "b"
    }`);
  const r = g.match('ab; a c; ab;', undefined, RECOVER);
  t.true(r.succeeded());
  const items = r._cst.children[0].children;
  t.deepEqual(kinds(items[1]), ['_fail', '_fail']);
  t.is(items[1].children[0].matchLength, 0);
  t.deepEqual(messages(r), ['Line 1, col 7: expected "b"']);
});

// --------------------------------------------------------------------
// 2 and 3. Failure scope and messages
// --------------------------------------------------------------------

test('a fallible that does not recover reports what `B C` reports', t => {
  const g = ohm.grammar(STMTS);
  const plain = ohm.grammar(PLAIN_STMTS);
  for (const input of ['{ a b', '{ a; b b', '{ a; ', '{ 1']) {
    const r = g.match(input, undefined, RECOVER);
    const p = plain.match(input);
    t.true(r.failed(), input);
    t.is(r.shortMessage, p.shortMessage, input);
    t.is(r.getRightmostFailurePosition(), p.getRightmostFailurePosition(), input);
    t.is(r.getExpectedText(), p.getExpectedText(), input);
  }
});

test('each recovered failure carries the message of the pass that permitted it', t => {
  const g = ohm.grammar(STMTS);
  const plain = ohm.grammar(PLAIN_STMTS);
  const r = g.match('{ a b; c d; e; }', undefined, RECOVER);
  t.true(r.succeeded());
  const failures = r.getRecoveredFailures();
  t.is(failures.length, 2);

  // The first entry is today's error exactly.
  const first = plain.match('{ a b; c d; e; }');
  t.is(failures[0].shortMessage, first.shortMessage);
  t.is(failures[0].position, first.getRightmostFailurePosition());
  t.is(failures[0].getExpectedText(), first.getExpectedText());
  t.deepEqual(
    failures[0].getRightmostFailures().map(f => f.toString()),
    first.getRightmostFailures().map(f => f.toString())
  );

  // The second is today's error once the first mistake is fixed.
  const second = plain.match('{ a; c d; e; }');
  t.is(failures[1].shortMessage, second.shortMessage.replace('col 6', 'col 10'));
  t.is(failures[1].interval.contents, 'c d');
  t.is(failures[0].interval.contents, 'a b');
});

test('getRecoveredFailures is empty without recovery', t => {
  const g = ohm.grammar(STMTS);
  t.deepEqual(g.match('{ a; }').getRecoveredFailures(), []);
  t.deepEqual(g.match('{ a; }', undefined, RECOVER).getRecoveredFailures(), []);
  t.deepEqual(g.match('{ a b; }').getRecoveredFailures(), []);
});

test('a parse recovery cannot finish lists its recoveries, then the final failure', t => {
  const g = ohm.grammar(STMTS);
  const r = g.match('{ a b; c d; e', undefined, RECOVER);
  t.true(r.failed());
  t.is(r.shortMessage, ohm.grammar(PLAIN_STMTS).match('{ a b; c d; e').shortMessage);
  const failures = r.getRecoveredFailures();
  t.deepEqual(
    failures.map(f => [f.interval.startIdx, f.interval.endIdx, f.position]),
    [
      [2, 5, 4],
      [7, 10, 9],
      [13, 13, 13],
    ]
  );
  t.is(failures[2].shortMessage, 'Line 1, col 14: expected ";" or a letter');
});

// --------------------------------------------------------------------
// 4. Memoization
// --------------------------------------------------------------------

test('a fallible inside `&` or `~` never recovers', t => {
  const g = ohm.grammar(String.raw`
    G {
      Start = &Line "x" any*
      Line = Body ! ";"
      Body = "a"
    }`);
  const r = g.match('xb;', undefined, RECOVER);
  t.true(r.failed());
  t.is(r.shortMessage, g.match('xb;').shortMessage);

  const n = ohm.grammar(String.raw`
    G {
      Start = ~Line any*
      Line = Body ! ";"
      Body = "a"
    }`);
  t.true(n.match('b;', undefined, RECOVER).succeeded());
  t.deepEqual(n.match('b;', undefined, RECOVER).getRecoveredFailures(), []);
});

test('a lookahead result is never memoized in place of a recovery', t => {
  const g = ohm.grammar(String.raw`
    G {
      Start = (&Item)? Item*
      Item = Body ! ";"
      Body = letter
    }`);
  const r = g.match('1;a;', undefined, RECOVER);
  t.true(r.succeeded());
  t.deepEqual(messages(r), ['Line 1, col 1: expected a letter']);
});

test('recovery is deterministic across calls on fresh matchers', t => {
  const g = ohm.grammar(STMTS);
  const input = '{ a b; c; d d d; e }';
  const first = g.match(input, undefined, RECOVER);
  const second = g.match(input, undefined, RECOVER);
  t.deepEqual(messages(first), messages(second));
  t.is(messages(first).length, 3);
});

// --------------------------------------------------------------------
// 5. Pass driver: every error, no cap
// --------------------------------------------------------------------

const HDL = String.raw`
Hdl {
  Chip = "CHIP" name "{" Parts "}"
  Parts = "PARTS:" Part* ! &"}"
  Part = PartBody ! ";"
  PartBody = name "(" ListOf<Wire, ","> ")"
  Wire = name "=" name
  name = letter alnum*
}`;

function chip(numParts, broken) {
  const parts = [];
  for (let i = 0; i < numParts; i++) {
    parts.push(broken.has(i) ? `  Nand(a=a b=b, out=w${i});` : `  Nand(a=a, b=b, out=w${i});`);
  }
  return `CHIP Big {\n PARTS:\n${parts.join('\n')}\n}\n`;
}

function spread(numParts, count) {
  const broken = new Set();
  for (let i = 0; i < count; i++) broken.add(Math.floor((i * numParts) / count));
  return broken;
}

for (const count of [100, 300]) {
  test(`a 13 KB chip with ${count} broken parts reports every error`, t => {
    const g = ohm.grammar(HDL);
    const input = chip(480, spread(480, count));
    t.true(input.length > 13000);
    const r = g.match(input, undefined, RECOVER);
    t.true(r.succeeded());
    const failures = r.getRecoveredFailures();
    t.is(failures.length, count);
    t.true(failures.every(f => f.shortMessage.endsWith('expected ")" or ","')));
    t.true(failures.every((f, i) => i === 0 || failures[i - 1].position < f.position));
    t.is(failures[0].shortMessage, g.match(input).shortMessage);
  });
}

// --------------------------------------------------------------------
// 6. Incremental matching
// --------------------------------------------------------------------

test('Matcher#match and Matcher#trace take the recover option', t => {
  const g = ohm.grammar(STMTS);
  const m = g.matcher();
  m.setInput('{ a b; }');
  const r = m.match(undefined, RECOVER);
  t.true(r.succeeded());
  t.is(r.getRecoveredFailures().length, 1);
  t.true(m.trace(undefined, RECOVER).succeeded);
});

test('a matcher with a stale or plain memo table refuses to recover', t => {
  const g = ohm.grammar(STMTS);

  const stale = g.matcher();
  stale.setInput('{ a; }');
  stale.match(undefined, RECOVER);
  stale.replaceInputRange(2, 3, 'b b');
  t.throws(() => stale.match(undefined, RECOVER), {message: /recover/});

  const plain = g.matcher();
  plain.setInput('{ a b; }');
  plain.match();
  t.throws(() => plain.match(undefined, RECOVER), {message: /recover/});

  const again = g.matcher();
  again.setInput('{ a b; }');
  t.is(again.match(undefined, RECOVER).getRecoveredFailures().length, 1);
  t.is(again.match(undefined, RECOVER).getRecoveredFailures().length, 1);
});

// --------------------------------------------------------------------
// 7. Static checks
// --------------------------------------------------------------------

test('both operands must have arity 1', t => {
  t.throws(() => ohm.grammar('G { S = "a" ! ("b" "c") }'), {message: /synchronizer.*arity/});
  t.throws(() => ohm.grammar('G { S = ("a" ! "b") ! "c" }'), {message: /guarded.*arity/});
  t.throws(() => ohm.grammar('G { S = ("a" "b") ! "c" }'), {message: /wrap it in a rule/});
  t.throws(() => ohm.grammar('G { S = ~"a" ! "c" }'), {message: /never consumes input/});
  t.throws(() => ohm.grammar('G { S = &"a" ! "c" }'), {message: /never consumes input/});
  t.notThrows(() => ohm.grammar('G { S = "a"* ! &"c" "c" }'));
});

test('a fallible is nullable only when `B C` is', t => {
  t.throws(() => ohm.grammar('G { S = ("a"? ! "b"?)* }'), {message: /nullable/});
  t.notThrows(() => ohm.grammar('G { S = ("a"? ! "b")* }'));
  t.notThrows(() => ohm.grammar('G { S = ("a" ! "b"?)* }'));
});

test('a trailing `!` has a clear message', t => {
  t.throws(() => ohm.grammar('G { S = "a" !\n T = "b" }'), {message: /synchronizer/});
  t.throws(() => ohm.grammar('G { S = "a" ! }'), {message: /synchronizer/});
});

test('toString parenthesizes a fallible', t => {
  const g = ohm.grammar('G { S = "{" "a"* ! &"}" "}" }');
  t.is(g.rules.S.body.toString(), '("{" ("a"* ! &"}") "}")');
});

test('`!` is an operator token', t => {
  const r = ohm.ohmGrammar.match('A ! B', 'tokens');
  t.true(r.succeeded());
  const s = ohm.ohmGrammar.createSemantics().addOperation('kinds', {
    tokens(ts) {
      return ts.children.map(c => c.kinds());
    },
    token(x) {
      return x.ctorName;
    },
  });
  t.deepEqual(
    s(r).kinds().filter(k => k !== 'any'),
    ['ident', 'operator', 'ident']
  );
});

test('a recipe round trips a fallible', t => {
  const g = ohm.grammar(STMTS);
  const g2 = ohm.makeRecipe(eval(g.toRecipe())); // eslint-disable-line no-eval
  t.is(g2.rules.Block.body.toString(), g.rules.Block.body.toString());
  t.deepEqual(messages(g2.match('{ a b; }', undefined, RECOVER)), messages(g.match('{ a b; }', undefined, RECOVER)));
});

// --------------------------------------------------------------------
// The `_fail` action
// --------------------------------------------------------------------

test('`_fail` has arity 0 and reads its failure from the node', t => {
  const g = ohm.grammar(STMTS);
  t.throws(() => g.createSemantics().addOperation('x', {_fail(f) {}}), {message: /_fail.*arity/});

  const s = g.createSemantics().addOperation('errs', {
    _nonterminal(...children) {
      return children.flatMap(c => c.errs());
    },
    _iter(...children) {
      return children.flatMap(c => c.errs());
    },
    _terminal() {
      return [];
    },
    _fail() {
      return this.recoveredFailure ? [this.recoveredFailure.shortMessage] : ['placeholder'];
    },
  });
  t.deepEqual(s(g.match('{ a b; c }', undefined, RECOVER)).errs(), [
    'placeholder',
    'Line 1, col 5: expected ";"',
    'Line 1, col 10: expected ";"',
  ]);
});

test('`_nonterminal` and `_default` never receive a `_fail` node', t => {
  const g = ohm.grammar(STMTS);
  const s = g.createSemantics().addOperation('count', {
    _nonterminal(...children) {
      return children.reduce((n, c) => n + c.count(), 1);
    },
    _iter(...children) {
      return children.reduce((n, c) => n + c.count(), 0);
    },
    _terminal() {
      return 0;
    },
  });
  t.is(s(g.match('{ a; }', undefined, RECOVER)).count(), 4);
  t.throws(() => s(g.match('{ a b; }', undefined, RECOVER)).count(), {
    message: /_fail.*Line 1, col 5/,
  });
});

// --------------------------------------------------------------------
// Tracing
// --------------------------------------------------------------------

test('a fallible that recovered is marked in the trace', t => {
  const g = ohm.grammar(STMTS);
  const trace = g.trace('{ a b; }', undefined, RECOVER);
  t.true(trace.succeeded);
  const recovered = [];
  trace.walk(node => {
    if (node.isRecovered) recovered.push(node);
  });
  t.is(recovered.length, 1);
  const [entry] = recovered;
  t.is(entry.expr.constructor.name, 'Fallible');
  t.true(entry.succeeded);
  // Its children are the failed attempt and the successful synchronizer.
  t.deepEqual(
    entry.children.map(c => [c.displayString, c.succeeded]),
    [
      ['Body', true],
      ['";"', false],
      ['";"', true],
    ]
  );
  t.regex(trace.toString(), /\(recovered\)/);

  const plain = g.trace('{ a b; }');
  t.false(plain.succeeded);
});

// --------------------------------------------------------------------
// Row based iteration (ohm-js/v18 compatibility mode)
// --------------------------------------------------------------------

test('row based iteration: the kept prefix is a list and the slots are unchanged', t => {
  const g = v18.grammar(STMTS);
  // `&"}"` keeps its binding as a synchronizer, so the slots match column mode.
  t.is(g.rules.Block.body.getArity(), 4);

  const clean = g.match('{ a; b; }', undefined, RECOVER);
  t.deepEqual(kinds(clean._cst), ['_terminal', '_list', '_terminal', '_terminal']);

  const r = g.match('{ a; b; c }', undefined, RECOVER);
  t.true(r.succeeded());
  t.deepEqual(kinds(r._cst), ['_terminal', '_list', '_fail', '_terminal']);
  t.deepEqual(kinds(r._cst.children[1]), ['Stmt', 'Stmt']);
  t.deepEqual(messages(r), ['Line 1, col 11: expected ";"']);

  const nothingKept = v18.grammar(STMTS.replace('Stmt* !', 'Stmt+ !')).match('{ c }', undefined, RECOVER);
  t.deepEqual(kinds(nothingKept._cst), ['_terminal', '_list', '_fail', '_terminal']);
  t.is(nothingKept._cst.children[1].children.length, 0);

  // The v18 CST view shows the `_fail` nodes.
  const root = r.getCstRoot();
  t.deepEqual(
    root.children.map(c => c.ctorName),
    ['_terminal', '_list', '_fail', '_terminal']
  );
  t.is(root.children[2].sourceString, 'c');
  t.is(root.children[2].recoveredFailure.shortMessage, 'Line 1, col 11: expected ";"');
});

test('row based iteration: an iterated fallible gives one row per element', t => {
  const g = v18.grammar(String.raw`
    G {
      Start = (Body ! ";")*
      Body = letter
    }`);
  const r = g.match('a;1;b;', undefined, RECOVER);
  t.true(r.succeeded());
  const rows = r._cst.children[0].children;
  t.deepEqual(rows.map(row => row.ctorName), ['_seq', '_seq', '_seq']);
  t.deepEqual(kinds(rows[1]), ['_fail', '_fail']);
  t.deepEqual(messages(r), ['Line 1, col 3: expected end of input or a letter']);
});
