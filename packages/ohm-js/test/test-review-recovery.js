import test from 'ava';
import * as ohm from '../index.mjs';

test('delimiter errors precede whitespace; word errors point to tokens', t => {
  const g = ohm.grammar('G { Start = "name" ";" "done" }');
  const r = g.match('name\n  done');
  t.is(r.getInterval().startIdx, 4);
  t.regex(r.shortMessage, /^Line 1,/);
  const words = ohm.grammar('G { Start = "name" "done" }').match('name\n  wrong');
  t.is(words.getInterval().startIdx, 7);
});

test('boundary insertion preserves later statements', t => {
  const g = ohm.grammar(`G {
    Start = Stmt*
    Stmt = ("let" ident "=" digit+) ! ";"
    ident = letter+
    recoveryInsertion = ";"
    recoveryBoundary = "let" ~alnum
  }`);
  const input = 'let a=1\nlet b=2\nlet c=3;';
  const r = g.match(input, undefined, {recover: true});
  t.true(r.succeeded());
  t.is(r.getRecoveredFailures().length, 2);
  t.true(r.getRecoveredFailures().every(f => f.missing));
  const values = g.createSemantics().addOperation('values', {
    Start(stmts) { return stmts.children.map(s => s.values()); },
    Stmt(_let, name, _eq, value, _correction, _semi) {
      return [name.sourceString, value.sourceString];
    }
  });
  t.deepEqual(values(r).values(), [['a', '1'], ['b', '2'], ['c', '3']]);
  t.true(g.match(input).failed());
});
