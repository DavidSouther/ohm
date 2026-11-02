import * as pexprs from './pexprs-main.js';

const analyses = new WeakMap();

function inspect(expr, application) {
  if (expr instanceof pexprs.Fallible || expr instanceof pexprs.Param) return true;
  if (expr instanceof pexprs.Apply) return application(expr.ruleName);
  if (expr instanceof pexprs.Alt) return expr.terms.some(term => inspect(term, application));
  if (expr instanceof pexprs.Seq) {
    return expr.factors.some(factor => inspect(factor, application));
  }
  if (
    expr instanceof pexprs.Iter ||
    expr instanceof pexprs.Not ||
    expr instanceof pexprs.Lookahead ||
    expr instanceof pexprs.Lex
  ) {
    return inspect(expr.expr, application);
  }
  return !(
    expr === pexprs.any ||
    expr === pexprs.end ||
    expr instanceof pexprs.Terminal ||
    expr instanceof pexprs.Range ||
    expr instanceof pexprs.UnicodeChar
  );
}

// Unknown expressions and parameters conservatively retain recovery bookkeeping.
// Rules with no transitive fallible dependency use ordinary packrat memoization.
export function recoveryAnalysis(grammar) {
  let analysis = analyses.get(grammar);
  if (analysis) return analysis;
  const sensitive = new Set();
  const users = new Map();
  for (const name in grammar.rules) {
    const direct = inspect(grammar.rules[name].body, dependency => {
      let callers = users.get(dependency);
      if (!callers) users.set(dependency, (callers = new Set()));
      callers.add(name);
      return false;
    });
    if (direct) sensitive.add(name);
  }
  const pending = [...sensitive];
  while (pending.length) {
    const dependency = pending.pop();
    for (const caller of users.get(dependency) || []) {
      if (!sensitive.has(caller)) {
        sensitive.add(caller);
        pending.push(caller);
      }
    }
  }
  const expressions = new WeakMap();
  analysis = {
    spaces: sensitive.has('spaces'),
    containsFallible(expr) {
      let result = expressions.get(expr);
      if (result === undefined) {
        result = inspect(expr, name => sensitive.has(name));
        expressions.set(expr, result);
      }
      return result;
    },
  };
  analyses.set(grammar, analysis);
  return analysis;
}
