import test from 'ava';
import * as ohm from '../index.mjs';

test('literal punctuation is eligible for insertion', t => {
  for (const text of ['done', '終', 'é', '\u0301', '١', '_', '\u0000', '\u200B']) {
    const literal = JSON.stringify(text);
    const g = ohm.grammar(`G {
      Start = Stmt* ! end
      Stmt = "a" ! ${literal}
    }`);
    const recovered = g.match(`aa${text}`, undefined, {recover: true});
    t.true(recovered.succeeded(), `join ${literal}`);
    t.is(recovered.getRecoveredFailures().length, 1, `join ${literal}`);
    t.true(recovered.getRecoveredFailures().every(f => !f.missing), `join ${literal}`);
  }
  const punctuation = ohm.grammar(`G {
    Start = Stmt* ! end
    Stmt = "a" ! "；"
  }`);
  const r = punctuation.match('aa；', undefined, {recover: true});
  t.true(r.succeeded());
  t.true(r.getRecoveredFailures()[0].missing);
});

test('an inserted join trace does not consume the following boundary token', t => {
  const cases = [
    ['Stmt = "a" ! ";"', 'aa;', 1],
    ['Stmt = ("let" name "=" digit+) ! ";"\n name = letter+', 'let a=1\nlet b=2\nlet c=3;', 2],
  ];
  for (const [rules, input, expectedCount] of cases) {
    const g = ohm.grammar(`G { Start = Stmt* ! end\n ${rules} }`);
    const trace = g.trace(input, undefined, {recover: true});
    t.true(trace.succeeded);
    let count = 0;
    trace.walk(node => {
      if (!node.isRecovered) return;
      count++;
      for (const child of node.children.filter(c => c.succeeded)) {
        t.true(child.pos1 >= node.pos1 && child.pos2 <= node.pos2, `${child.displayString}`);
      }
    });
    t.is(count, expectedCount);
    t.is(trace.result._cst.children[0].children.length, expectedCount + 1);
  }
});

test('boundary insertion preserves later statements', t => {
  const g = ohm.grammar(`G {
    Start = Stmt* ! end
    Stmt = ("let" ident "=" digit+) ! ";"
    ident = letter+
  }`);
  const input = 'let a=1\nlet b=2\nlet c=3;';
  const r = g.match(input, undefined, {recover: true});
  t.true(r.succeeded());
  t.is(r.getRecoveredFailures().length, 2);
  t.true(r.getRecoveredFailures().every(f => f.missing));
  const values = g.createSemantics().addOperation('values', {
    Start(stmts, _correction, _end) { return stmts.children.map(s => s.values()); },
    Stmt(_let, name, _eq, value, _correction, _semi) {
      return [name.sourceString, value.sourceString];
    }
  });
  t.deepEqual(values(r).values(), [['a', '1'], ['b', '2'], ['c', '3']]);
  t.true(g.match(input).failed());
});
