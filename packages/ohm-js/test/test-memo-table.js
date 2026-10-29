import test from 'ava';
import * as ohm from '../index.mjs';
import {MemoTable} from '../src/MemoTable.js';

const add = (table, pos, key, extra = {}) =>
  table.add(
    pos,
    key,
    extra.matchLength ?? 1,
    extra.examinedLength ?? 1,
    extra.value ?? true,
    extra.failures,
    extra.rightmostFailureOffset ?? -1,
    extra.tokenEndOffset ?? -1
  );

test('entries are found by position and key, and replaced by a new entry', t => {
  const table = new MemoTable();
  const a = table.internKey('a');
  const b = table.internKey('b');
  t.is(table.internKey('a'), a);
  t.is(table.find(3, a), -1);

  const first = add(table, 3, a, {matchLength: 2});
  const other = add(table, 3, b);
  t.is(table.find(3, a), first);
  t.is(table.find(3, b), other);
  t.is(table.find(4, a), -1);
  t.is(table.matchLength[first], 2);

  const second = add(table, 3, a, {matchLength: 5});
  t.not(second, first);
  t.is(table.find(3, a), second);
  t.false(table.isLive(first));
  t.is(table.matchLength[second], 5);
  t.is(table.live, 2);

  table.remove(second);
  table.remove(second); // removing twice is harmless
  t.is(table.find(3, a), -1);
  t.is(table.find(3, b), other);
});

test('entry columns and rows grow past their initial capacity', t => {
  const table = new MemoTable();
  const keys = [0, 1, 2].map(i => table.internKey(`rule${i}`));
  for (let pos = 0; pos < 5000; pos++) {
    for (const key of keys) add(table, pos, key, {matchLength: pos % 7, value: pos});
  }
  t.is(table.live, 15000);
  for (const pos of [0, 1, 255, 256, 4999]) {
    const entry = table.find(pos, keys[2]);
    t.is(table.matchLength[entry], pos % 7);
    t.is(table.values[entry], pos);
  }
  t.is(table.find(5000, keys[0]), -1);
});

test('applications active at a position nest, and clearing a pass drops them', t => {
  const table = new MemoTable();
  const a = table.internKey('a');
  const b = table.internKey('b');
  const c = table.internKey('c');
  table.beginPass(10);

  table.enter(2, a);
  table.enter(5, c);
  table.enter(2, b);
  t.true(table.isActive(2, a));
  t.true(table.isActive(2, b));
  t.false(table.isActive(2, c));
  t.true(table.isActive(5, c));
  t.deepEqual(table.activeKeys(2), [a, b]);

  table.exit(2);
  t.false(table.isActive(2, b));
  t.deepEqual(table.activeKeys(2), [a]);
  table.exit(5);
  table.exit(2);
  t.deepEqual(table.activeKeys(2), []);

  // A pass that threw leaves applications active; the next pass starts clean.
  table.enter(4, a);
  table.enter(4, b);
  table.beginPass(10);
  t.false(table.isActive(4, a));
  t.is(table.depth, 0);
});

test('a left recursion records the applications involved, and gates reuse of its result', t => {
  const table = new MemoTable();
  const head = table.internKey('head');
  const mid = table.internKey('mid');
  const other = table.internKey('other');
  table.beginPass(10);

  table.enter(0, head);
  table.enter(0, mid);
  const seed = add(table, 0, head, {value: false});
  table.startLeftRecursion(0, seed, head);
  t.true(table.isLeftRecursion(seed));
  t.is(table.currentLeftRecursion(0), seed);
  t.is(table.headKey(seed), head);
  t.true(table.isInvolved(seed, mid));
  t.false(table.isInvolved(seed, other));

  // `other` is applied later, inside the recursion; a second visit learns that it is involved.
  table.enter(0, other);
  table.updateInvolvedKeys(0, seed);
  t.true(table.isInvolved(seed, other));
  table.exit(0);
  table.exit(0);

  // Only `head` is active now, and it is not involved, so the seed can be used. While an involved
  // application is active at the position it cannot.
  t.true(table.shouldUseMemoizedResult(0, seed));
  table.enter(0, mid);
  t.false(table.shouldUseMemoizedResult(0, seed));
  table.exit(0);

  table.endLeftRecursion(0);
  t.is(table.currentLeftRecursion(0), -1);
  t.true(table.isLeftRecursion(seed)); // the flag outlives the recursion
  table.exit(0);
});

test('replacing a range drops entries inside it and moves later ones', t => {
  const table = new MemoTable();
  const a = table.internKey('a');
  table.beginPass(10);
  for (let pos = 0; pos <= 10; pos++) add(table, pos, a, {value: pos});

  // Replace [3, 6) by two characters: the entries at 3, 4 and 5 go, and later ones move down one.
  table.replaceRange(3, 6, 2, 9);
  t.is(table.live, 8);
  for (const pos of [0, 1, 2]) t.is(table.values[table.find(pos, a)], pos);
  t.is(table.find(3, a), -1);
  t.is(table.find(4, a), -1);
  for (let pos = 6; pos <= 10; pos++) {
    t.is(table.values[table.find(pos - 1, a)], pos, `the entry from ${pos} is now at ${pos - 1}`);
  }
  t.is(table.find(10, a), -1);
});

test('invalidating drops entries that examined input past the edit', t => {
  const table = new MemoTable();
  const a = table.internKey('a');
  const b = table.internKey('b');
  table.beginPass(10);
  add(table, 0, a, {examinedLength: 3}); // reaches position 3
  add(table, 0, b, {examinedLength: 1}); // reaches position 1
  add(table, 1, a, {examinedLength: 1}); // reaches position 2
  add(table, 5, a, {examinedLength: 4}); // at or after the edit

  table.invalidate(2, 2);
  t.is(table.find(0, a), -1);
  t.true(table.find(0, b) >= 0);
  t.true(table.find(1, a) >= 0); // examined [1, 2), which ends at the edit
  t.true(table.find(5, a) >= 0); // positions at or after `endPos` are not checked
});

test('many removals are compacted away between matches without losing entries', t => {
  const table = new MemoTable();
  const a = table.internKey('a');
  const b = table.internKey('b');
  const c = table.internKey('c');
  table.beginPass(2000);
  const kept = [];
  for (let pos = 0; pos < 1500; pos++) {
    add(table, pos, a, {value: `a${pos}`});
    table.remove(add(table, pos, b));
    table.remove(add(table, pos, c));
    if (pos % 100 === 0) kept.push(pos);
  }
  const {count} = table;
  table.replaceRange(1999, 1999, 1, 2001); // an edit at the end moves nothing
  t.true(table.count < count, 'removed entries were squeezed out');
  t.is(table.count, 1500);
  t.is(table.live, 1500);
  for (const pos of kept) t.is(table.values[table.find(pos, a)], `a${pos}`);
  t.is(table.find(10, b), -1);
});

test('positionInfo summarizes the entries at a position', t => {
  const table = new MemoTable();
  const a = table.internKey('a');
  const b = table.internKey('b');
  add(table, 2, a, {examinedLength: 4, rightmostFailureOffset: 1});
  add(table, 2, b, {examinedLength: 2, rightmostFailureOffset: 3});
  const info = table.positionInfo(2);
  t.is(info.maxExaminedLength, 4);
  t.is(info.maxRightmostFailureOffset, 3);
  t.deepEqual([...info.memo.keys()], ['a', 'b']);
  t.is(info.memo.get('b').examinedLength, 2);
  t.is(table.positionInfo(1), undefined);
});

// ---------------------------------------------------------------------------------------------
// The memo table is what lets a Matcher reuse work across edits, so check every edit against a
// match of the new input from scratch.
// ---------------------------------------------------------------------------------------------

function random(seed) {
  let state = seed;
  return n => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state % n;
  };
}

const GRAMMAR = String.raw`G {
  Prog = Stmt*
  Stmt = Expr ";"
  Expr = Expr "+" Term  -- plus
       | Expr "-" Term  -- minus
       | Term
  Term = Term "*" Atom  -- times
       | Atom
  Atom = "(" Expr ")"  -- paren
       | ident
       | number
  ident = letter alnum*
  number = digit+
}`;

const grammar = ohm.grammar(GRAMMAR);
const shapeOf = grammar.createSemantics().addOperation('shape', {
  _nonterminal(...children) {
    return `${this.ctorName}(${children.map(c => c.shape()).join(',')})`;
  },
  _iter(...children) {
    return `[${children.map(c => c.shape()).join(',')}]`;
  },
  _terminal() {
    return this.sourceString;
  },
});

function shape(result) {
  if (result.failed()) return `failed@${result.getRightmostFailurePosition()}`;
  return shapeOf(result).shape();
}

test('random edits to a Matcher give the same results as matching the new input fresh', t => {
  const g = grammar;
  const pieces = ['a', 'b1', '12', '+', '-', '*', '(', ')', ';', ' ', 'xyz', '3;'];
  const next = random(12345);
  let input = 'a+b*(c-1); d*2;';
  const matcher = g.matcher();
  matcher.setInput(input);
  matcher.match();
  for (let step = 0; step < 300; step++) {
    const start = next(input.length + 1);
    const end = Math.min(input.length, start + next(4));
    const insert = next(3) === 0 ? '' : pieces[next(pieces.length)];
    matcher.replaceInputRange(start, end, insert);
    input = input.slice(0, start) + insert + input.slice(end);
    t.is(matcher.getInput(), input);
    const incremental = matcher.match();
    const fresh = g.match(input);
    t.is(incremental.succeeded(), fresh.succeeded(), `step ${step}: ${JSON.stringify(input)}`);
    t.is(shape(incremental), shape(fresh), `step ${step}: ${JSON.stringify(input)}`);
    if (input.length > 60) {
      input = input.slice(0, 30);
      matcher.setInput(input);
      matcher.match();
    }
  }
});
