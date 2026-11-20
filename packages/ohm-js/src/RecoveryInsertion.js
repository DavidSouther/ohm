// Decides whether a recovering Fallible may infer its missing punctuation join
// at a scan position: the join must be a punctuation literal, and the input at
// that position must continue the enclosing grammar. Every budget or window
// limit makes a check inconclusive, never successful; an inconclusive check
// rejects insertion at that position and the scan continues with skip recovery.

import {InputStream} from './InputStream.js';
import {MatchState} from './MatchState.js';
import {NonterminalNode, TerminalNode} from './nodes.js';
import * as p from './pexprs-main.js';

const tables = new WeakMap();
const exhausted = Symbol('continuation budget');
// Input code units visible to one continuation probe.
const WINDOW = 256;
// Expression evaluations in one probe; four times as many input reads.
const FUEL = 1024;
// Grammar-walking steps per candidate construction or `canResumeAt` call.
const PREPROCESS_FUEL = 4096;
// Remaining preprocessing steps, or undefined outside `withPreprocessBudget`.
// Saved and restored by `withPreprocessBudget`, so nested calls are safe.
let preprocessBudget;

// Require a punctuation or symbol literal. Connector punctuation can be part of a name.
function isPunctuationLiteral(text) {
  return text.length > 0 && !/[^\p{P}\p{S}]|\p{Pc}/u.test(text);
}

function spendPreprocess() {
  if (preprocessBudget !== undefined && --preprocessBudget < 0) throw exhausted;
}

function withPreprocessBudget(fn, fallback) {
  const previous = preprocessBudget;
  preprocessBudget = PREPROCESS_FUEL;
  try {
    return fn();
  } catch (err) {
    if (err !== exhausted) throw err;
    return fallback;
  } finally {
    preprocessBudget = previous;
  }
}

// Check the authored traversal before substituteParams allocates its result.
function chargeSubstitution(expr) {
  const pending = [expr];
  while (pending.length) {
    spendPreprocess();
    const current = pending.pop();
    if (current instanceof p.Alt) {
      for (const child of current.terms) pending.push(child);
    } else if (current instanceof p.Seq) {
      for (const child of current.factors) pending.push(child);
    } else if (current instanceof p.Apply) {
      for (const child of current.args) pending.push(child);
    } else if (current instanceof p.Fallible) {
      pending.push(current.guarded, current.join);
    } else if (current.expr) {
      pending.push(current.expr);
    }
  }
}

function table(grammar) {
  let found = tables.get(grammar);
  if (found) return found;
  found = new WeakMap();
  tables.set(grammar, found);
  let id = 0;
  const visit = (expr, tail, lexified = false) => {
    if (expr instanceof p.Fallible) {
      found.set(expr, {id: ++id, tail});
      visit(expr.guarded, {expr: expr.join, lexified, next: tail}, lexified);
    } else if (expr instanceof p.Seq) {
      // Share each suffix among preceding factors and materialize it only
      // when recovery tries an insertion at a site that uses it.
      for (let i = expr.factors.length - 1; i >= 0; i--) {
        const part = expr.factors[i];
        visit(part, tail, lexified);
        tail = {expr: part, lexified, next: tail};
      }
    } else if (expr instanceof p.Alt) {
      expr.terms.forEach(part => visit(part, tail, lexified));
    } else if (expr instanceof p.Iter) {
      const repeat = expr instanceof p.Opt ? tail : {
        expr: new p.Star(expr.expr),
        lexified,
        next: tail,
      };
      visit(expr.expr, repeat, lexified);
    } else if (expr instanceof p.Lex) {
      visit(expr.expr, tail, true);
    }
  };
  for (const name in grammar.rules) visit(grammar.rules[name].body, null);
  return found;
}

function resolve(expr, args) {
  if (!args?.length) return expr;
  if (preprocessBudget !== undefined) chargeSubstitution(expr);
  return expr.substituteParams(args);
}

// A frame's string identity is the site, the active application's memo key and
// the lexical mode; callers compose it with the enclosing context id.
export function insertionFrame(fallible, state) {
  const site = table(state.grammar).get(fallible._insertionSite || fallible);
  const app = state.currentApplication();
  const args = app?.args;
  const mode = state.inSyntacticContext();
  const join = resolve(fallible.join, args);
  const repeat =
    fallible.guarded instanceof p.Iter && !(fallible.guarded instanceof p.Opt)
      ? fallible.guarded.expr
      : undefined;
  // The active memo key already identifies the resolved application within
  // this matcher; avoid serializing expanded arguments or the join again.
  const activeKey = state.memoTable.depth
    ? state.memoTable.stackKey[state.memoTable.depth - 1] : -1;
  const identity = JSON.stringify([site?.id, activeKey, mode]);
  return {
    join,
    tail: site?.tail,
    repeat,
    args,
    mode,
    continuationMode: app?.isSyntactic() || false,
    toString: () => identity,
  };
}

// Requires an expression that `literalNode` accepted.
function literalExpression(expr, grammar) {
  if (expr instanceof p.Terminal) return expr;
  if (expr instanceof p.Seq) return literalExpression(expr.factors[0], grammar);
  return literalExpression(resolve(grammar.rules[expr.ruleName].body, expr.args), grammar);
}

function literalNode(expr, grammar, active = new Set()) {
  spendPreprocess();
  if (expr instanceof p.Terminal && isPunctuationLiteral(expr.obj)) {
    return new TerminalNode(0);
  }
  if (expr instanceof p.Seq && expr.factors.length === 1) {
    return literalNode(expr.factors[0], grammar, active);
  }
  if (expr instanceof p.Apply && !active.has(expr.ruleName)) {
    const body = resolve(grammar.rules[expr.ruleName].body, expr.args);
    const child = literalNode(body, grammar, new Set(active).add(expr.ruleName));
    return child && new NonterminalNode(expr.ruleName, [child], [0], 0);
  }
  return null;
}

// Extracted rule bodies retain their application's matching mode. A lexical
// helper must not acquire implicit spaces when used as syntactic evidence.
class ApplicationPrefix extends p.Lex {
  constructor(expr, syntactic) {
    super(expr);
    this.syntactic = syntactic;
  }

  eval(state) {
    state.skipSpacesIfInSyntacticContext();
    state._applicationStack.push(new p.Apply(this.syntactic ? 'Prefix' : 'prefix'));
    state.inLexifiedContextStack.push(false);
    try {
      return state.eval(this.expr);
    } finally {
      state._applicationStack.pop();
      state.inLexifiedContextStack.pop();
    }
  }
}

// Prefix evidence stops at the next guarded expression and is provisional: it
// does not grant a full match to the next item, whose own missing join must be
// eligible for insertion when the ordinary recovery pass reaches it.
function prefixThroughGuard(expr, grammar, active = new Set()) {
  spendPreprocess();
  if (expr instanceof p.Fallible) {
    return expr.insertion !== false && literalNode(expr.join, grammar) ? expr.guarded : null;
  }
  if (expr instanceof p.Apply && !active.has(expr.ruleName)) {
    const body = resolve(grammar.rules[expr.ruleName].body, expr.args);
    const part = prefixThroughGuard(body, grammar, new Set(active).add(expr.ruleName));
    return part && new ApplicationPrefix(part, expr.isSyntactic());
  }
  if (expr instanceof p.Seq) {
    for (let i = 0; i < expr.factors.length; i++) {
      const part = prefixThroughGuard(expr.factors[i], grammar, active);
      if (part) return new p.Seq([...expr.factors.slice(0, i), part]);
    }
  }
  if (expr instanceof p.Alt) {
    const parts = expr.terms.map(part => prefixThroughGuard(part, grammar, active)).filter(Boolean);
    return parts.length ? new p.Alt(parts) : null;
  }
  if (expr instanceof p.Lex) {
    const part = prefixThroughGuard(expr.expr, grammar, active);
    return part && new p.Lex(part);
  }
  return null;
}

function nullable(expr, grammar, active = new Set()) {
  spendPreprocess();
  if (expr === p.end || expr instanceof p.Not || expr instanceof p.Lookahead) return true;
  if (expr instanceof p.Terminal) return expr.obj.length === 0;
  if (expr instanceof p.Star || expr instanceof p.Opt) return true;
  if (expr instanceof p.Lex || expr instanceof p.Iter) {
    return nullable(expr.expr, grammar, active);
  }
  if (expr instanceof p.Seq) {
    return expr.factors.every(part => nullable(part, grammar, active));
  }
  if (expr instanceof p.Alt) return expr.terms.some(part => nullable(part, grammar, active));
  if (expr instanceof p.Fallible) {
    return nullable(expr.guarded, grammar, active) && nullable(expr.join, grammar, active);
  }
  if (expr instanceof p.Apply && !active.has(expr.ruleName)) {
    return nullable(
      resolve(grammar.rules[expr.ruleName].body, expr.args),
      grammar,
      new Set(active).add(expr.ruleName)
    );
  }
  return false;
}

// Conservative first-character gate. Unknown prefixes are admitted, but still
// subject to the same fixed sandbox budget as known prefixes.
function starts(expr, grammar, source, pos, active = new Set()) {
  spendPreprocess();
  if (expr instanceof p.Terminal) return source.startsWith(expr.obj.slice(0, 1), pos);
  if (expr === p.end) return pos === source.length;
  if (expr instanceof p.UnicodeChar) {
    const cp = source.codePointAt(pos);
    return cp !== undefined && expr.pattern.test(String.fromCodePoint(cp));
  }
  if (expr instanceof p.Range) {
    const cp = expr.matchCodePoint ? source.codePointAt(pos) : source.charCodeAt(pos);
    return cp !== undefined && expr.from.codePointAt(0) <= cp && cp <= expr.to.codePointAt(0);
  }
  if (expr instanceof p.Apply && !active.has(expr.ruleName)) {
    return starts(
      resolve(grammar.rules[expr.ruleName].body, expr.args),
      grammar,
      source,
      pos,
      new Set(active).add(expr.ruleName)
    );
  }
  if (expr instanceof p.Alt) {
    return expr.terms.some(part => starts(part, grammar, source, pos, active));
  }
  if (expr instanceof p.Seq) {
    for (const part of expr.factors) {
      if (starts(part, grammar, source, pos, active)) return true;
      if (!nullable(part, grammar)) return false;
    }
    return pos === source.length;
  }
  if (expr instanceof p.Fallible) return starts(expr.guarded, grammar, source, pos, active);
  if (expr instanceof p.Iter || expr instanceof p.Lex) {
    return starts(expr.expr, grammar, source, pos, active);
  }
  return true;
}

function probe(state, candidates, pos) {
  class ProbeState extends MatchState {
    eval(expr) {
      if (--this.fuel < 0) throw exhausted;
      return super.eval(expr);
    }
  }

  const {source} = state.inputStream;
  let end = Math.min(source.length, pos + WINDOW);
  if (
    end < source.length &&
    /[\uD800-\uDBFF]/.test(source[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(source[end])
  ) {
    end--;
  }
  const input = source.slice(pos, end);
  const matcher = state.grammar.matcher().setInput(input);
  const sentinel = new p.Apply('spaces');
  const sandbox = new ProbeState(matcher, new p.Seq([sentinel]));
  sandbox.fuel = FUEL;
  let charFuel = FUEL * 4;
  for (const name of ['next', 'nextCodePoint', 'atEnd']) {
    const original = sandbox.inputStream[name];
    sandbox.inputStream[name] = function (...args) {
      if (--charFuel < 0) throw exhausted;
      return original.apply(this, args);
    };
  }
  try {
    for (const candidate of candidates) {
      sandbox.inputStream.pos = 0;
      sandbox._bindings.length = 0;
      sandbox._bindingOffsets.length = 0;
      // A sentinel preserves lexical mode even without a caller application.
      sandbox._applicationStack = [
        new p.Apply(candidate.mode ? 'Continuation' : 'continuation'),
      ];
      const matched = sandbox.eval(candidate.expr);
      // Past a truncated window, the slice end would act as the end of input.
      const touchedEdge =
        end < source.length && sandbox.inputStream.examinedLength > input.length;
      if (touchedEdge) return false;
      if (matched && (sandbox.inputStream.pos > 0 || pos === source.length)) return true;
    }
    return false;
  } catch (err) {
    if (err !== exhausted) throw err;
    return false;
  } finally {
    // The probed span is part of the result's dependencies, so an edit there
    // invalidates reuse of this recovering match's results.
    state.inputStream.examinedLength = Math.max(
      state.inputStream.examinedLength,
      pos + Math.min(input.length + 1, sandbox.inputStream.examinedLength)
    );
  }
}

export function insertionCandidate(fallible, state, frame) {
  return withPreprocessBudget(() => buildInsertionCandidate(fallible, state, frame), null);
}

function buildInsertionCandidate(fallible, state, frame) {
  // The sandbox cannot reproduce matcher userData or a custom input stream on a
  // slice; those matches use skip recovery only.
  if (
    fallible.insertion === false ||
    state.userData !== undefined ||
    state.inputStream.constructor !== InputStream
  ) {
    return null;
  }
  const node = literalNode(frame.join, state.grammar);
  if (!node) return null;
  const candidates = [];
  const add = (expr, mode) => {
    candidates.push({expr, mode});
    const guarded = prefixThroughGuard(expr, state.grammar);
    if (guarded) candidates.push({expr: guarded, mode});
  };
  const tail = [];
  for (let part = frame.tail; part; part = part.next) {
    spendPreprocess();
    const expr = resolve(part.expr, frame.args);
    tail.push(part.lexified ? new p.Lex(expr) : expr);
  }
  // A repetition suffix offers a next element as well as its eventual exit.
  if (tail[0] instanceof p.Iter) add(tail[0].expr, frame.continuationMode);
  if (tail.length) add(new p.Seq(tail), frame.continuationMode);
  if (tail.every(expr => nullable(expr, state.grammar))) {
    const outer = state._recoveryFrames.at(-1);
    if (outer) {
      const before = frame.continuationMode ? tail : tail.map(expr => new p.Lex(expr));
      if (outer.repeat) {
        add(new p.Seq([...before, resolve(outer.repeat, outer.args)]), outer.mode);
      }
      // The enclosing join supplies exit evidence.
      add(new p.Seq([...before, outer.join]), outer.mode);
    } else {
      add(new p.Seq([...tail, p.end]), frame.continuationMode);
    }
  }
  return {
    node,
    literal: literalExpression(frame.join, state.grammar),
    canResumeAt(pos) {
      return withPreprocessBudget(() => {
        const gated = candidates.filter(
          candidate =>
            (candidate.mode &&
              starts(
                state.grammar.rules.spaces.body,
                state.grammar,
                state.inputStream.source,
                pos
              )) ||
            starts(candidate.expr, state.grammar, state.inputStream.source, pos)
        );
        return gated.length > 0 && probe(state, gated, pos);
      }, false);
    },
  };
}
