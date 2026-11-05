import test from 'ava';
import * as ohm from 'ohm-js';
import type {Node} from 'ohm-js';

import {declare, defineLanguage, descendants, ref, scope} from './define.ts';
import {CALC} from './test-calc.ts';
import type {Analysis} from './types.ts';

/** One line per diagnostic: code, name and offset, as the spike prints them. */
const diags = (a: Analysis) =>
  a.diagnostics.map(
    d => `${d.code} ${a.text.slice(d.span.start, d.span.end)}@${d.span.start}`
  );

function calcLanguage() {
  let evaluated = 0;
  const calc = defineLanguage(ohm.grammar(CALC), {start: 'Program'});
  calc.operation('eval(env)', {
    Program(stmts) {
      return stmts.children.map(s => s.eval(this.args.env));
    },
    Stmt(b, _c, _s) {
      return b.eval(this.args.env);
    },
    StmtBody(x) {
      return x.eval(this.args.env);
    },
    Assign: ref(
      name => name,
      'variable',
      {orDeclare: 'variable', after: true},
      function (name, _eq, rhs) {
        evaluated++;
        return (this.args.env[name.sourceString] = rhs.eval(this.args.env));
      }
    ),
    Exp_add(l, _p, r) {
      return l.eval(this.args.env) + r.eval(this.args.env);
    },
    Pri_paren(_l, e, _r) {
      return e.eval(this.args.env);
    },
    Var: ref(
      name => name,
      'variable',
      function (name) {
        evaluated++;
        return this.args.env[name.sourceString];
      }
    ),
    number(_d) {
      return parseInt(this.sourceString, 10);
    },
  });
  return {calc, evaluations: () => evaluated};
}

test('wrapped eval still evaluates', t => {
  const {calc} = calcLanguage();

  t.deepEqual(calc.semantics(calc.grammar.match('a = 1; b = a + 2;')).eval({}), [1, 3]);
});

test('roles are found without running an action body', t => {
  const {calc, evaluations} = calcLanguage();

  const a = calc.analyze('a = 1;\nb = a + c;\n');

  t.is(evaluations(), 0);
  t.deepEqual(diags(a), ['ref.undefined c@15']);
  t.deepEqual(
    a.symbols.map(s => `${s.name}@${s.nameSpan.start}`),
    ['a@0', 'b@7']
  );
});

test('calculator spike samples', t => {
  const {calc} = calcLanguage();

  t.deepEqual(diags(calc.analyze('a = 1;\nb = a + ;\nc = b;\n')), ['syntax.expected +@13']);
  t.deepEqual(diags(calc.analyze('a = 1;\nb = ;\nc = b;\n')), [
    'ref.uncertain b@7',
    'syntax.expected =@9',
    'ref.uncertain b@17',
  ]);
  t.deepEqual(diags(calc.analyze('x = x + 1;\n')), ['ref.undefined x@4']);
});

test('conflicting wrappers for one rule throw naming the rule', t => {
  const {calc} = calcLanguage();

  const err = t.throws(() =>
    calc.operation('other', {
      Var: ref(
        name => name,
        'value',
        (_name: Node) => 0
      ),
    })
  );

  t.regex(err.message, /'Var'/);
});

test('the same wrapper in a second operation is not a conflict', t => {
  const {calc} = calcLanguage();

  t.notThrows(() =>
    calc.operation('size', {
      Var: ref(
        name => name,
        'variable',
        (_name: Node) => 1
      ),
    })
  );
});

test('wrappers nest so one rule carries several roles', t => {
  const w = scope(
    declare(
      name => name,
      'chip',
      {hoist: true},
      ref(name => name, 'pin')
    )
  );

  t.deepEqual(
    w.descriptors.map(d => d.role),
    ['scope', 'declare', 'ref']
  );
  t.is(w.action, undefined);
});

test('roles takes wrappers for rules with no action, and arrays compose', t => {
  const calc = defineLanguage(ohm.grammar(CALC), {start: 'Program'});
  calc.roles({
    Assign: [declare(name => name, 'variable'), ref((_n, _e, rhs) => rhs, 'other')],
    Pri_block: scope(),
  });

  const a = calc.analyze('a = b;\n');

  t.deepEqual(
    a.symbols.map(s => s.name),
    ['a']
  );
  t.deepEqual(
    a.references.map(r => r.name),
    ['b']
  );
});

test('a function kind is computed from the parameters', t => {
  const calc = defineLanguage(ohm.grammar(CALC), {start: 'Program'});
  calc.roles({
    Assign: declare(
      name => name,
      name => `k${name.sourceString}`
    ),
  });

  t.deepEqual(
    calc.analyze('a = 1;\n').symbols.map(s => s.kind),
    ['ka']
  );
});

test('an unknown rule throws naming it', t => {
  const calc = defineLanguage(ohm.grammar(CALC), {start: 'Program'});

  const err = t.throws(() => calc.roles({Nope: scope()}));

  t.regex(err.message, /'Nope'/);
});

test('roles cannot change once the language has analyzed text', t => {
  const calc = defineLanguage(ohm.grammar(CALC), {start: 'Program'});
  calc.roles({Assign: declare(name => name, 'variable')});
  calc.analyze('a = 1;');

  t.throws(() => calc.roles({Var: ref(name => name, 'variable')}), {message: /roles/});
});

test('the service entry serves the language', t => {
  const {calc} = calcLanguage();
  const svc = calc.service();

  svc.open('u', 1, 'a = 1;\nb = a;\n');

  t.deepEqual(
    svc.documentSymbols('u').map(s => s.name),
    ['a', 'b']
  );
});

test('descendants lists nodes of a rule and skips corrections', t => {
  const g = ohm.grammar(CALC);
  const s = g.createSemantics();
  const root = s(g.match('a = b;\nc = ;\nd;\n', 'Program', {recover: true})) as Node;

  t.deepEqual(
    descendants(root, 'Var').map(n => n.sourceString),
    ['b', 'c', 'd']
  );
  t.deepEqual(descendants(root, '_correction'), []);
});
