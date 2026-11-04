/**
 * The `corrections` option of `addOperation`, `addAttribute`, `extendOperation` and
 * `extendAttribute`, and `Wrapper#isCorrection`. test-fallible-acceptance.js pins the default:
 * an operation with no `_correction` action throws on a recovered node.
 */

import test from 'ava';
import * as ohm from '../index.mjs';

const RECOVER = {recover: true};

const grammar = ohm.grammar(String.raw`
  Statements {
    Start = Stmt*
    Stmt = letter+ ! ";"
  }
`);

// Recovery skips `12`: the first statement has a correction, the second has none.
const BROKEN = 'abc 12; def;';
const CLEAN = 'abc; def;';
const broken = () => grammar.match(BROKEN, undefined, RECOVER);

// A traversal that knows nothing about corrections. It counts terminals, and `?? 0` stands in
// for the `undefined` that a skipped correction yields.
const terminals = {
  _nonterminal(...children) {
    return children.reduce((sum, child) => sum + (child.count() ?? 0), 0);
  },
  _iter(...children) {
    return children.reduce((sum, child) => sum + (child.count() ?? 0), 0);
  },
  _terminal() {
    return 1;
  },
};

// The same traversal as an attribute, which is read as a property.
const terminalsAttribute = {
  _nonterminal(...children) {
    return children.reduce((sum, child) => sum + (child.count ?? 0), 0);
  },
  _iter(...children) {
    return children.reduce((sum, child) => sum + (child.count ?? 0), 0);
  },
  _terminal() {
    return 1;
  },
};

// `abc` `;` `def` `;` -- the skipped `12` is not counted.
const TERMINALS = 8;

test('isCorrection is true only on correction nodes', t => {
  const found = [];
  const note = wrapper => found.push([wrapper.ctorName, wrapper.isCorrection()]);
  const s = grammar.createSemantics().addOperation('visit', {
    _nonterminal(...children) {
      note(this);
      children.forEach(c => c.visit());
    },
    _iter(...children) {
      note(this);
      children.forEach(c => c.visit());
    },
    _terminal() {
      note(this);
    },
    _correction() {
      note(this);
    },
  });
  s(broken()).visit();
  t.deepEqual(
    found.filter(([, isCorrection]) => isCorrection),
    [['_correction', true]]
  );
  t.true(found.length > 1);
});

test("an operation throws on a correction node by default, with 'throw', and for attributes", t => {
  const byDefault = grammar.createSemantics().addOperation('count', terminals);
  t.throws(() => byDefault(broken()).count(), {message: /_correction/});

  const explicit = grammar
    .createSemantics()
    .addOperation('count', terminals, {corrections: 'throw'});
  t.throws(() => explicit(broken()).count(), {message: /_correction/});

  const emptyOptions = grammar.createSemantics().addOperation('count', terminals, {});
  t.throws(() => emptyOptions(broken()).count(), {message: /_correction/});

  const attribute = grammar.createSemantics().addAttribute('count', terminalsAttribute);
  t.throws(() => attribute(broken()).count, {message: /_correction/});

  // Without a correction there is nothing to throw about.
  t.is(byDefault(grammar.match(CLEAN)).count(), TERMINALS);
});

test("corrections: 'skip' yields undefined for a correction node", t => {
  const s = grammar.createSemantics().addOperation(
    'fragments',
    {
      Start(statements) {
        return statements.children.map(statement => statement.fragments());
      },
      Stmt(letters, correction, _semi) {
        return [letters.sourceString, correction.fragments()];
      },
      _iter(...children) {
        return children.map(child => child.fragments());
      },
    },
    {corrections: 'skip'}
  );
  // The first correction slot holds the skipped input; the second is an empty optional.
  t.deepEqual(s(broken()).fragments(), [
    ['abc', undefined],
    ['def', []],
  ]);
});

test("corrections: 'skip' lets a traversal that knows nothing about recovery finish", t => {
  const s = grammar.createSemantics().addOperation('count', terminals, {corrections: 'skip'});
  t.is(s(broken()).count(), TERMINALS);
  t.is(s(grammar.match(CLEAN)).count(), TERMINALS);
});

test('a function is a zero-arity action for correction nodes', t => {
  const seen = [];
  const s = grammar.createSemantics().addOperation('count', terminals, {
    corrections() {
      seen.push(this.sourceString);
      return 100;
    },
  });
  t.is(s(broken()).count(), TERMINALS + 100);
  t.deepEqual(seen, ['12']);

  // Its arity is checked like that of any `_correction` action.
  t.throws(
    () => grammar.createSemantics().addOperation('count', terminals, {corrections: x => x}),
    {message: /'_correction' has the wrong arity/}
  );
});

test('an explicit `_correction` action wins over the option', t => {
  for (const corrections of ['skip', () => 'from the option']) {
    const s = grammar.createSemantics().addOperation(
      'tag',
      {
        Start(statements) {
          return statements.children.map(statement => statement.tag());
        },
        Stmt(_letters, correction, _semi) {
          return correction.tag();
        },
        _iter(...children) {
          return children.map(child => child.tag());
        },
        _correction() {
          return 'explicit';
        },
      },
      {corrections}
    );
    t.deepEqual(s(broken()).tag(), ['explicit', []]);
  }
});

test('an attribute with a correction policy memoizes its result', t => {
  let calls = 0;
  const s = grammar.createSemantics().addAttribute(
    'tagged',
    {
      Start(statements) {
        return statements.children.map(statement => statement.tagged);
      },
      Stmt(_letters, correction, _semi) {
        return correction.tagged;
      },
      _iter(...children) {
        return children.map(child => child.tagged);
      },
    },
    {
      corrections() {
        calls++;
        return 'fix';
      },
    }
  );
  const root = s(broken());
  t.deepEqual(root.tagged, ['fix', []]);
  t.deepEqual(root.tagged, ['fix', []]);
  t.is(calls, 1);
});

test('extendOperation and extendAttribute take the option, and extensions inherit it', t => {
  const attributeActions = {
    _nonterminal(...children) {
      return children.reduce((sum, child) => sum + (child.size ?? 0), 0);
    },
    _iter(...children) {
      return children.reduce((sum, child) => sum + (child.size ?? 0), 0);
    },
    _terminal() {
      return 1;
    },
  };
  const base = grammar
    .createSemantics()
    .addOperation('count', terminals)
    .addAttribute('size', attributeActions);

  // Extending can set the policy without changing the base.
  const extended = grammar
    .extendSemantics(base)
    .extendOperation('count', {}, {corrections: 'skip'})
    .extendAttribute('size', {}, {corrections: 'skip'});
  t.throws(() => base(broken()).count(), {message: /_correction/});
  t.throws(() => base(broken()).size, {message: /_correction/});
  t.is(extended(broken()).count(), TERMINALS);
  t.is(extended(broken()).size, TERMINALS);

  // A later extension keeps the policy it inherits, whatever else it overrides.
  const again = grammar.extendSemantics(extended).extendOperation('count', {
    _terminal() {
      return 2;
    },
  });
  t.is(again(broken()).count(), 2 * TERMINALS);

  // An extension may also replace the policy.
  const replaced = grammar.extendSemantics(extended).extendOperation(
    'count',
    {},
    {
      corrections() {
        return 100;
      },
    }
  );
  t.is(replaced(broken()).count(), TERMINALS + 100);

  // 'throw' cannot undo an inherited policy, so it is refused rather than ignored.
  t.throws(
    () =>
      grammar.extendSemantics(extended).extendOperation('count', {}, {corrections: 'throw'}),
    {message: /Cannot extend operation 'count' with corrections: 'throw'/}
  );
});

test('a correction policy survives a recipe round trip', t => {
  const s = grammar.createSemantics().addOperation('count', terminals, {corrections: 'skip'});
  // Recipes are source text for a function, as in test-recipes.js.
  const copy = ohm.makeRecipe(eval(s.toRecipe()));
  t.is(copy(copy.getGrammar().match(BROKEN, undefined, RECOVER)).count(), TERMINALS);
});

test('invalid options are refused', t => {
  const add = options => grammar.createSemantics().addOperation('count', terminals, options);
  t.throws(() => add('skip'), {instanceOf: TypeError, message: /options object/});
  t.throws(() => add(null), {instanceOf: TypeError, message: /options object/});
  t.throws(() => add({corrections: 'ignore'}), {
    instanceOf: TypeError,
    message: /'throw', 'skip' or a function/,
  });
  t.throws(() => add({corrections: 1}), {
    instanceOf: TypeError,
    message: /'throw', 'skip' or a function/,
  });
  t.throws(() => add({correction: 'skip'}), {
    instanceOf: TypeError,
    message: /unknown option 'correction'/,
  });
  t.notThrows(() => add(undefined));
});
