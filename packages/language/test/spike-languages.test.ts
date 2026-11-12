/**
 * The HDL and Jack single file samples of the layer 2 spike
 * (spikes/roles-wrappers-spike.mjs), with its printed output as the oracle.
 * Offsets in the expectations are the spike's, without its document prefix.
 */

import test from 'ava';
import {readFileSync} from 'node:fs';
import * as ohm from 'ohm-js';
import type {Node} from 'ohm-js';
import {declare, defineLanguage, descendants, ref, scope} from '@ohm-js/language';
import type {Analysis} from '@ohm-js/language';

const read = (file: string) => readFileSync(new URL(`data/${file}`, import.meta.url), 'utf8');

/** The spike's summary lines: declarations, references, silent names and diagnostics. */
function summary(a: Analysis) {
  return {
    decls: a.symbols.map(
      s => `${s.kind} ${s.name}@${s.nameSpan.start}${s.implicit ? ' (implicit)' : ''}`
    ),
    refs: a.references
      .map(r => {
        const to = r.target;
        return `${r.name}@${r.nameSpan.start}->${to ? (to.external ? 'ext' : `@${to.nameSpan.start}`) : '?'}`;
      })
      .join(' '),
    silent: a.references.filter(r => r.status === 'silent').map(r => r.name),
    diags: a.diagnostics
      .filter(d => d.code !== 'syntax.expected')
      .map(d => `${d.code} ${a.text.slice(d.span.start, d.span.end)}@${d.span.start}`)
      .sort(),
  };
}

function hdl() {
  const g = ohm.grammars(read('base.ohm') + '\n' + read('hdl.ohm')).Hdl;
  const chips: Record<string, string[]> = {Nand: ['a', 'b', 'out'], Not: ['in', 'out']};
  const lang = defineLanguage(g, {
    start: 'Root',
    external: {chip: name => (chips[name] ? {members: chips[name]} : undefined)},
  });
  const name0 = (n: Node) => descendants(n, 'Name')[0];
  lang.roles({
    Chip_closed: scope(),
    Chip_unclosed: scope(),
    ChipHead: declare((_k, name) => name, 'chip', {hoist: true}),
    PinDecl: declare(name => name, 'pin'),
    ClockedBody: ref((_k, pins) => descendants(pins, 'Name'), 'pin'),
    PartBody: ref(name => name, 'chip', {external: true, as: 'part'}),
    Wire: ref(
      lhs => name0(lhs),
      'pin',
      {via: c => c.part},
      ref((_l, _e, rhs) => (rhs.ctorName === 'WireSide' ? name0(rhs) : []), 'pin', {
        orDeclare: 'pin',
        private: true,
      })
    ),
  });
  return lang;
}

const AND = `CHIP And {\n IN a, b;\n OUT out;\n PARTS:\n Nand(a=a, b=b, out=x);\n Not(in=x, out=out);\n}`;

test('HDL valid', t => {
  t.deepEqual(summary(hdl().analyze(AND)), {
    decls: ['chip And@5', 'pin a@15', 'pin b@18', 'pin out@26', 'pin x@59 (implicit)'],
    refs: 'Nand@40->ext a@45->ext a@47->@15 b@50->ext b@52->@18 out@55->ext x@59->@59 Not@64->ext in@68->ext x@71->@59 out@74->ext out@78->@26',
    silent: [],
    diags: [],
  });
});

test('HDL bad member and undefined chip', t => {
  const a = hdl().analyze(AND.replace('in=x', 'inn=x').replace('Nand(', 'Nandd('));

  t.deepEqual(summary(a), {
    decls: ['chip And@5', 'pin a@15', 'pin b@18', 'pin out@26', 'pin x@60 (implicit)'],
    refs: 'Nandd@40->? a@46->? a@48->@15 b@51->? b@53->@18 out@56->? x@60->@60 Not@65->ext inn@69->? x@73->@60 out@76->ext out@80->@26',
    silent: ['a', 'b', 'out'],
    diags: ['ref.undefined Nandd@40', 'ref.undefinedMember inn@69'],
  });
});

test('HDL missing semicolon', t => {
  const a = hdl().analyze(AND.replace('out=x);', 'out=x)'));

  t.deepEqual(summary(a), {
    decls: ['chip And@5', 'pin a@15', 'pin b@18', 'pin out@26', 'pin x@59 (implicit)'],
    refs: 'Nand@40->ext a@45->ext a@47->@15 b@50->ext b@52->@18 out@55->ext x@59->@59',
    silent: [],
    diags: [],
  });
  t.true(a.hasSkippedInput);
});

test('HDL duplicate pin', t => {
  t.deepEqual(summary(hdl().analyze(AND.replace('IN a, b', 'IN a, a'))), {
    decls: [
      'chip And@5',
      'pin a@15',
      'pin a@18',
      'pin out@26',
      'pin b@52 (implicit)',
      'pin x@59 (implicit)',
    ],
    refs: 'Nand@40->ext a@45->ext a@47->@15 b@50->ext b@52->@52 out@55->ext x@59->@59 Not@64->ext in@68->ext x@71->@59 out@74->ext out@78->@26',
    silent: [],
    diags: ['def.duplicate a@18'],
  });
});

function jack() {
  const g = ohm.grammars(read('base.ohm') + '\n' + read('jack.ohm')).Jack;
  const lang = defineLanguage(g, {
    start: 'Root',
    namespaces: {
      value: ['static', 'field', 'local', 'parameter'],
      subroutine: ['constructor', 'function', 'method'],
      class: ['class'],
    },
    external: {class: name => (name === 'Output' ? {members: ['printInt']} : undefined)},
  });
  const kindOf = (n: Node) => n.child(0).sourceString;
  const idOnly = (t: Node) =>
    t.ctorName === 'jackIdentifier' && t.sourceString !== 'void' ? t : [];
  lang.roles({
    Class_body: scope(),
    Class_unclosed: scope(),
    SubroutineDec: scope(),
    ClassHead: declare((_k, n) => n, 'class', {hoist: true}),
    ClassVarDecBody: declare(
      (_k, _t, n, rest) => [n, ...descendants(rest, 'jackIdentifier')],
      k => kindOf(k),
      {private: true, type: (_k, t) => t}
    ),
    SubroutineHead: declare(
      (_k, _r, n) => n,
      k => kindOf(k),
      {
        hoist: true,
        data: (_k, _r, _n, _l, params) => ({arity: descendants(params, 'Parameter').length}),
      }
    ),
    Parameter: declare((_t, n) => n, 'parameter', {type: t => t}),
    VarDecBody: declare(
      (_v, _t, n, rest) => [n, ...descendants(rest, 'jackIdentifier')],
      'local',
      {
        type: (_v, t) => t,
      }
    ),
    type: ref(t => idOnly(t), 'class'),
    arrayAccessStart: ref(id => id, 'value'),
    LetTarget: ref(t => idOnly(t), 'value'),
    Term: ref(t => idOnly(t), 'value'),
    SubroutineName: ref(n => idOnly(n), 'subroutine'),
    compoundIdentifier: ref(
      recv => recv,
      ['value', 'class'],
      {external: true, as: 'recv'},
      ref((_r, _d, name) => name, 'subroutine', {via: c => c.recv})
    ),
  });
  return lang;
}

const MAIN = `class Main {
  field int x, y;
  static boolean flag;
  constructor Main new(int ax, int ay) { let x = ax; let y = ay; return this; }
  method int sum(int k) { var int t; let t = x + k; return t; }
  function void main() {
    var Main m;
    var int r;
    let m = Main.new(1, 2);
    let r = m.sum(3);
    do Output.printInt(r);
    return;
  }
}`;

/** The spike printed reference lines cut at a fixed width; compare that much. */
const refsPrefix = (refs: string, oracle: string) => refs.slice(0, oracle.length);

test('Jack valid', t => {
  const s = summary(jack().analyze(MAIN));
  const oracle =
    'Main@68->@6 x@99->@25 ax@103->@81 y@111->@28 ay@115->@89 t@175->@168 x@179->@25 k@183->@155 t@193->@168 Main@231->@6 m@262->@236 Main@266->@6 new@271->@73 r@290->@251 m@294->@236 sum@296->@147 Output@311->ext printInt@318->e';

  t.deepEqual(s.decls, [
    'class Main@6',
    'field x@25',
    'field y@28',
    'static flag@48',
    'constructor new@73',
    'parameter ax@81',
    'parameter ay@89',
    'method sum@147',
    'parameter k@155',
    'local t@168',
    'function main@214',
    'local m@236',
    'local r@251',
  ]);
  t.is(refsPrefix(s.refs, oracle), oracle);
  t.deepEqual(s.silent, []);
  t.deepEqual(s.diags, []);
});

test('Jack undefined and duplicate', t => {
  const text = MAIN.replace('let r = m.sum(3)', 'let r = m.sumz(zz)').replace(
    'var int t;',
    'var int t; var int k;'
  );

  const s = summary(jack().analyze(text));

  t.deepEqual(s.diags, [
    'def.duplicate k@179',
    'ref.undefined zz@312',
    'ref.undefinedMember sumz@307',
  ]);
  t.deepEqual(s.silent, []);
  t.true(s.decls.includes('local k@179'));
});

test('Jack missing semicolon', t => {
  const a = jack().analyze(MAIN.replace('let y = ay;', 'let y = ay'));
  const s = summary(a);
  const oracle =
    'Main@68->@6 x@99->@25 ax@103->@81 y@111->@28 ay@115->@89 t@174->@167 x@178->@25 k@182->@154 t@192->@167 Main@230->@6 m@261->@235 Main@265->@6 new@270->@73 r@289->@250 m@293->@235 sum@295->@146 Output@310->ext printInt@317->e';

  t.true(a.hasSkippedInput);
  t.is(s.decls.length, 13);
  t.is(refsPrefix(s.refs, oracle), oracle);
  t.deepEqual(s.diags, []);
});

test('Jack subroutine data is kept on the symbol', t => {
  const a = jack().analyze(MAIN);

  t.deepEqual(a.symbols.find(s => s.name === 'new')?.data, {arity: 2});
});

test('Jack private field is not reachable as a member', t => {
  const s = summary(jack().analyze(MAIN.replace('let r = m.sum(3)', 'let r = m.x(3)')));

  t.deepEqual(s.diags, ['ref.undefinedMember x@296']);
});
