/**
 * The `corrections` option of `addOperation`, `addAttribute`, `extendOperation` and
 * `extendAttribute`, and `Wrapper#isCorrection`. By default a correction node yields `undefined`;
 * `corrections: 'throw'` makes it an error. test-fallible-acceptance.js covers the user-facing
 * behavior on a larger grammar.
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

test('a correction node yields undefined by default, and with {} or "skip"', t => {
  const fragments = {
    Start(statements) {
      return statements.children.map(statement => statement.fragments());
    },
    Stmt(letters, correction, _semi) {
      return [letters.sourceString, correction.fragments()];
    },
    _iter(...children) {
      return children.map(child => child.fragments());
    },
  };
  for (const options of [undefined, {}, {corrections: 'skip'}]) {
    const s = grammar.createSemantics().addOperation('fragments', fragments, options);
    // The first correction slot holds the skipped input; the second is an empty optional.
    t.deepEqual(s(broken()).fragments(), [
      ['abc', undefined],
      ['def', []],
    ]);
  }

  const attribute = grammar.createSemantics().addAttribute('count', terminalsAttribute);
  t.is(attribute(broken()).count, TERMINALS);
});

test('a traversal that knows nothing about recovery finishes a recovered tree', t => {
  const s = grammar.createSemantics().addOperation('count', terminals);
  t.is(s(broken()).count(), TERMINALS);
  t.is(s(grammar.match(CLEAN)).count(), TERMINALS);
});

test("corrections: 'throw' makes a correction node an error, for operations and attributes", t => {
  const operation = grammar
    .createSemantics()
    .addOperation('count', terminals, {corrections: 'throw'});
  t.throws(() => operation(broken()).count(), {
    message: /Missing semantic action for _correction/,
  });

  const attribute = grammar
    .createSemantics()
    .addAttribute('count', terminalsAttribute, {corrections: 'throw'});
  t.throws(() => attribute(broken()).count, {
    message: /Missing semantic action for _correction/,
  });

  // Without a correction there is nothing to throw about.
  t.is(operation(grammar.match(CLEAN)).count(), TERMINALS);
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
  for (const corrections of ['throw', 'skip', () => 'from the option']) {
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

test('an attribute memoizes what a correction yields', t => {
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

  // The default memoizes `undefined` as well.
  let reads = 0;
  const skipping = grammar.createSemantics().addAttribute('read', {
    Stmt(_letters, correction, _semi) {
      reads++;
      return correction.read;
    },
    _iter(...children) {
      return children.map(child => child.read);
    },
    Start(statements) {
      return statements.children.map(statement => statement.read);
    },
  });
  const skipped = skipping(broken());
  t.deepEqual(skipped.read, [undefined, []]);
  t.deepEqual(skipped.read, [undefined, []]);
  t.is(reads, 2);
});

test('extensions inherit the policy, and an option replaces it', t => {
  const base = grammar
    .createSemantics()
    .addOperation('count', terminals, {corrections: 'throw'});

  // Inherited: still strict, and the base is unaffected by extending it.
  const inherited = grammar.extendSemantics(base).extendOperation('count', {
    _terminal() {
      return 2;
    },
  });
  t.throws(() => inherited(broken()).count(), {message: /_correction/});

  // Replaced, in both directions.
  const relaxed = grammar
    .extendSemantics(base)
    .extendOperation('count', {}, {corrections: 'skip'});
  t.is(relaxed(broken()).count(), TERMINALS);
  t.throws(() => base(broken()).count(), {message: /_correction/});

  const lenient = grammar.createSemantics().addOperation('count', terminals);
  const strict = grammar
    .extendSemantics(lenient)
    .extendOperation('count', {}, {corrections: 'throw'});
  t.throws(() => strict(broken()).count(), {message: /_correction/});
  t.is(lenient(broken()).count(), TERMINALS);

  // A later extension keeps the policy it inherits, whatever else it overrides.
  const again = grammar.extendSemantics(relaxed).extendOperation('count', {
    _terminal() {
      return 2;
    },
  });
  t.is(again(broken()).count(), 2 * TERMINALS);

  // A function option adds an action, which wins over a policy, inherited or not.
  const handled = grammar.extendSemantics(base).extendOperation(
    'count',
    {},
    {
      corrections() {
        return 100;
      },
    }
  );
  t.is(handled(broken()).count(), TERMINALS + 100);
  const stillHandled = grammar
    .extendSemantics(handled)
    .extendOperation('count', {}, {corrections: 'throw'});
  t.is(stillHandled(broken()).count(), TERMINALS + 100);
});

test('extendAttribute takes the option too', t => {
  const base = grammar.createSemantics().addAttribute('count', terminalsAttribute);
  const strict = grammar
    .extendSemantics(base)
    .extendAttribute('count', {}, {corrections: 'throw'});
  t.throws(() => strict(broken()).count, {message: /_correction/});
  t.is(base(broken()).count, TERMINALS);
});

// Recipes are source text for a function, as in test-recipes.js.
const roundTrip = semantics => ohm.makeRecipe(eval(semantics.toRecipe()));

test('a non-default policy survives a recipe round trip', t => {
  const strict = grammar
    .createSemantics()
    .addOperation('count', terminals, {corrections: 'throw'});
  const copy = roundTrip(strict);
  t.throws(() => copy(copy.getGrammar().match(BROKEN, undefined, RECOVER)).count(), {
    message: /_correction/,
  });

  const lenient = grammar.createSemantics().addOperation('count', terminals);
  const lenientCopy = roundTrip(lenient);
  t.is(
    lenientCopy(lenientCopy.getGrammar().match(BROKEN, undefined, RECOVER)).count(),
    TERMINALS
  );

  // Only the options that differ from the inherited policy are written.
  t.false(lenient.toRecipe().includes('corrections'));
  t.true(strict.toRecipe().includes('"corrections": "throw"'));

  const handled = grammar.createSemantics().addOperation('count', terminals, {
    corrections() {
      return 100;
    },
  });
  const handledCopy = roundTrip(handled);
  t.is(
    handledCopy(handledCopy.getGrammar().match(BROKEN, undefined, RECOVER)).count(),
    TERMINALS + 100
  );
});

test('an extension keeps its policy through a recipe round trip', t => {
  const base = grammar.createSemantics().addOperation('count', terminals);
  const extended = grammar
    .extendSemantics(base)
    .extendOperation('count', {}, {corrections: 'throw'});
  const copy = roundTrip(extended);
  t.throws(() => copy(copy.getGrammar().match(BROKEN, undefined, RECOVER)).count(), {
    message: /_correction/,
  });
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
