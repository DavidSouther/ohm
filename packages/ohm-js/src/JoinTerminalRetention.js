import {CaseInsensitiveTerminal} from './CaseInsensitiveTerminal.js';
import * as pexprs from './pexprs-main.js';

// Proves that a fallible join consumes input whenever it succeeds. A failed
// join may report its diagnostic at the guard's last retained terminal only
// with that proof. The result is true only when proved; false is always safe,
// because the diagnostic then keeps the rightmost failure position.
//
// The numeric limits below (proof allowance, depth, cache sizes) bound the
// cost of a proof. Reaching one yields false.

const maxCachedApplications = 64;
const maxCachedKeyLength = 1024;

// The proof allowance scales with the number of authored expressions.
function proofAllowanceForGrammar(grammar) {
  const seen = new WeakSet();
  const pending = [];
  for (const name in grammar.rules) pending.push(grammar.rules[name].body);
  let count = 0;
  while (pending.length) {
    const expr = pending.pop();
    if (!expr || seen.has(expr)) continue;
    seen.add(expr);
    count++;
    if (expr instanceof pexprs.Alt) {
      for (const term of expr.terms) pending.push(term);
    } else if (expr instanceof pexprs.Seq) {
      for (const factor of expr.factors) pending.push(factor);
    } else if (expr instanceof pexprs.Apply) {
      for (const arg of expr.args) pending.push(arg);
    } else if (expr instanceof pexprs.Fallible) {
      pending.push(expr.guarded, expr.join);
    } else if (expr instanceof CaseInsensitiveTerminal) {
      pending.push(expr.obj);
    } else if (expr.expr) {
      pending.push(expr.expr);
    }
  }
  return Math.max(256, count * 8);
}

// Keep actuals as references to expressions in their original environments.
// Substituting them can construct trees exponentially larger than the grammar.
function expressionRef(expr, env, context) {
  while (expr instanceof pexprs.Param) {
    if (context.remainingProofAllowance-- <= 0 || !env.args[expr.index]) {
      context.proofInterruptions++;
      return undefined;
    }
    ({expr, env} = env.args[expr.index]);
  }
  let byEnv = context.references.get(expr);
  if (!byEnv) {
    byEnv = new WeakMap();
    context.references.set(expr, byEnv);
  }
  let ref = byEnv.get(env);
  if (!ref) {
    ref = {expr, env, id: ++context.nextId};
    byEnv.set(env, ref);
  }
  return ref;
}

function argumentRefs(actuals, env, context) {
  const args = [];
  for (const arg of actuals) {
    if (context.remainingProofAllowance-- <= 0) {
      context.proofInterruptions++;
      return undefined;
    }
    const actual = expressionRef(arg, env, context);
    if (!actual) return undefined;
    args.push(actual);
  }
  return args;
}

function proveTerminalRetention(ref, grammar, context) {
  if (!ref || context.depth >= 2048 || context.remainingProofAllowance-- <= 0) {
    context.proofInterruptions++;
    return false;
  }
  context.depth++;
  try {
    return proveExpressionTerminalRetention(ref, grammar, context);
  } finally {
    context.depth--;
  }
}

function proveExpressionTerminalRetention({expr, env}, grammar, context) {
  const visit = child =>
    proveTerminalRetention(expressionRef(child, env, context), grammar, context);
  if (expr === pexprs.any || expr instanceof pexprs.Range || expr instanceof pexprs.UnicodeChar) {
    return true;
  }
  if (expr instanceof pexprs.Terminal) return typeof expr.obj === 'string' && expr.obj.length > 0;
  if (expr instanceof CaseInsensitiveTerminal) {
    const actual = expressionRef(expr.obj, env, context);
    return !!actual && actual.expr instanceof pexprs.Terminal && actual.expr.obj.length > 0;
  }
  if (expr instanceof pexprs.Alt) return expr.terms.length > 0 && expr.terms.every(visit);
  if (expr instanceof pexprs.Seq) return expr.factors.some(visit);
  if (expr instanceof pexprs.Plus || expr instanceof pexprs.Lex) return visit(expr.expr);
  if (expr instanceof pexprs.Apply) {
    const rule = grammar.rules[expr.ruleName];
    if (!rule) return false;
    const args = argumentRefs(expr.args, env, context);
    if (!args) return false;
    const key = `${expr.ruleName}:${args.map(arg => arg.id).join(',')}`;
    if (context.memo.has(key)) return context.memo.get(key);
    if (context.active.has(key)) {
      context.proofInterruptions++;
      return false;
    }
    context.active.add(key);
    const interruptionsBefore = context.proofInterruptions;
    const frame = {args};
    const result = proveTerminalRetention(
      expressionRef(rule.body, frame, context), grammar, context
    );
    context.active.delete(key);
    // An interrupted subproof may succeed on a different path or with more allowance.
    if (result || interruptionsBefore === context.proofInterruptions) context.memo.set(key, result);
    return result;
  }
  return false;
}

function proveJoinInFreshContext(join, actuals, grammar, proofAllowance) {
  const context = {
    active: new Set(),
    memo: new Map(),
    references: new WeakMap(),
    nextId: 0,
    proofInterruptions: 0,
    depth: 0,
    remainingProofAllowance: proofAllowance,
  };
  const args = argumentRefs(actuals, {args: []}, context);
  return !!args && proveTerminalRetention(expressionRef(join, {args}, context), grammar, context);
}

export function createJoinTerminalProofCache(grammar) {
  return {
    proofAllowance: proofAllowanceForGrammar(grammar),
    joinProofsWithoutArguments: new WeakMap(),
    joinIds: new WeakMap(),
    nextJoinId: 0,
    proofsByJoinApplication: new Map(),
  };
}

// True guarantees that success retains a nonempty terminal. False leaves
// retention unproved. Each cached proof starts with a fresh allowance.
pexprs.PExpr.prototype.retainsTerminalOnSuccess = function (grammar, app) {
  const join = this;
  const cache = grammar._joinTerminalProofCache;
  const {proofAllowance, joinProofsWithoutArguments, joinIds, proofsByJoinApplication} = cache;
  if (!app?.args.length) {
    let result = joinProofsWithoutArguments.get(join);
    if (result === undefined) {
      result = proveJoinInFreshContext(join, [], grammar, proofAllowance);
      joinProofsWithoutArguments.set(join, result);
    }
    return result;
  }

  // Packrat lookup already keyed the resolved application before entering it.
  // Bound retained keys even if callers supply arbitrarily many distinct actuals.
  const memoKey = app._memoKey;
  if (typeof memoKey !== 'string' || memoKey.length > maxCachedKeyLength) {
    return proveJoinInFreshContext(join, app.args, grammar, proofAllowance);
  }
  let joinId = joinIds.get(join);
  if (joinId === undefined) {
    joinId = cache.nextJoinId++;
    joinIds.set(join, joinId);
  }

  const key = `${joinId}:${memoKey}`;
  const cached = proofsByJoinApplication.get(key);
  const result = cached ?? proveJoinInFreshContext(join, app.args, grammar, proofAllowance);
  if (cached !== undefined) proofsByJoinApplication.delete(key);
  proofsByJoinApplication.set(key, result);
  if (proofsByJoinApplication.size > maxCachedApplications) {
    proofsByJoinApplication.delete(proofsByJoinApplication.keys().next().value);
  }
  return result;
};
