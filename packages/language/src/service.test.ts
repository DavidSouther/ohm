import test from 'ava';
import type {Node} from 'ohm-js';

import {addRoles, roles} from './roles.ts';
import {createLanguageService} from './service.ts';
import {calc, span} from './test-calc.ts';
import {offset} from './types.ts';

function service() {
  const {sem} = calc();
  addRoles(sem, {
    Assign: (n: Node, _e: Node, _r: Node) =>
      roles.ref(n, 'variable', {orDeclare: 'variable', after: true}),
    Var: (n: Node) => roles.ref(n, 'variable'),
    Pri_block: (_o: Node, _s: Node, _c: Node) => roles.scope(),
  });
  return createLanguageService(sem, {start: 'Program'});
}

const V1 = 'a = 1;\nb = a + c;\n';

test('queries over a calculator document', t => {
  const svc = service();

  svc.open('u', 1, V1);

  t.deepEqual(
    svc.documentSymbols('u').map(s => s.name),
    ['a', 'b']
  );
  t.deepEqual(
    svc.definition('u', offset(11)).map(s => s.nameSpan),
    [span(0, 1)]
  );
  t.deepEqual(svc.references('u', offset(0), true), [span(0, 1), span(11, 12)]);
  t.deepEqual(svc.references('u', offset(11), false), [span(11, 12)]);
  t.deepEqual(svc.rename('u', offset(0), 'first'), [
    {uri: 'u', span: span(0, 1), newText: 'first'},
    {uri: 'u', span: span(11, 12), newText: 'first'},
  ]);
  const names = svc.completion('u', offset(15)).map(s => s.name);
  t.true(names.includes('a'));
  t.false(names.includes('b'));
});

test('a cursor at the end of a name still finds it', t => {
  const svc = service();
  svc.open('u', 1, V1);

  t.deepEqual(
    svc.definition('u', offset(12)).map(s => s.nameSpan),
    [span(0, 1)]
  );
});

test('typing keeps symbols', t => {
  const svc = service();
  svc.open('u', 1, V1);

  const a = svc.change('u', 2, 'a = 1;\nb = ;\nc = b;\n');

  t.is(a.version, 2);
  t.deepEqual(
    svc.documentSymbols('u').map(s => s.name),
    ['a', 'c']
  );
});

test('a query at a position on no name returns empty', t => {
  const svc = service();
  svc.open('u', 1, V1);

  t.deepEqual(svc.definition('u', offset(3)), []);
  t.deepEqual(svc.references('u', offset(3), true), []);
  t.deepEqual(svc.rename('u', offset(3), 'z'), []);
});

test('an undefined use has no definition', t => {
  const svc = service();
  svc.open('u', 1, V1);

  t.deepEqual(svc.definition('u', offset(15)), []);
});

test('rename to a name that collides gives no edits', t => {
  const svc = service();
  svc.open('u', 1, V1);

  t.deepEqual(svc.rename('u', offset(0), 'b'), []);
});

test('a document with no tree serves stale symbols and withholds positional answers', t => {
  const svc = service();
  svc.open('u', 1, V1);

  const latest = svc.change('u', 2, 'a = 1;\n+++');

  t.false(latest.hasTree);
  t.true(svc.analysis('u')?.stale);
  t.is(svc.analysis('u')?.analysis.version, 1);
  t.deepEqual(
    svc.documentSymbols('u').map(s => s.name),
    ['a', 'b']
  );
  t.deepEqual(svc.definition('u', offset(11)), []);
  t.deepEqual(svc.references('u', offset(0), true), []);
  t.deepEqual(svc.rename('u', offset(0), 'first'), []);
  t.deepEqual(svc.completion('u', offset(15)), []);
});

test('an unknown uri returns empty results', t => {
  const svc = service();

  t.is(svc.analysis('nope'), undefined);
  t.deepEqual(svc.documentSymbols('nope'), []);
  t.deepEqual(svc.definition('nope', offset(0)), []);
  t.deepEqual(svc.references('nope', offset(0), true), []);
  t.deepEqual(svc.rename('nope', offset(0), 'x'), []);
  t.deepEqual(svc.completion('nope', offset(0)), []);
  t.notThrows(() => svc.close('nope'));
});

test('close drops state', t => {
  const svc = service();
  svc.open('u', 1, V1);

  svc.close('u');

  t.is(svc.analysis('u'), undefined);
  t.deepEqual(svc.documentSymbols('u'), []);
});

test('completion inside a block offers inner and outer names, inner first', t => {
  const svc = service();
  const text = 'a = 1;\nb = {c = 2;\nc + a;};\n';
  svc.open('u', 1, text);

  const names = svc.completion('u', offset(text.indexOf('+'))).map(s => s.name);

  t.deepEqual(names, ['c', 'a']);
});

test('an external target has no location and cannot be renamed', t => {
  const {sem} = calc();
  addRoles(sem, {Var: (n: Node) => roles.ref(n, 'variable', {external: true})});
  const svc = createLanguageService(sem, {
    start: 'Program',
    external: {variable: name => (name === 'pi' ? {} : undefined)},
  });
  svc.open('u', 1, 'pi;\npi;\n');

  t.deepEqual(svc.analysis('u')?.analysis.diagnostics, []);
  t.deepEqual(svc.definition('u', offset(0)), []);
  t.deepEqual(svc.references('u', offset(0), true), [span(0, 2), span(4, 6)]);
  t.deepEqual(svc.rename('u', offset(0), 'tau'), []);
});
