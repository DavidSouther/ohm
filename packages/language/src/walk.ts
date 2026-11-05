import type {MatchResult, Node, Semantics} from 'ohm-js';

import {isRole, ROLES_ATTRIBUTE} from './roles.ts';
import {offset} from './types.ts';
import type {Diagnostic, Offset, RefOpts, Role, RoleNode, Scope, Span, Symbol} from './types.ts';

export interface RefEntry {
  name: string;
  kinds: readonly string[];
  nameSpan: Span;
  scope: Scope;
  opts: RefOpts;
  /** End of the node whose action produced this ref. */
  ownerEnd: Offset;
}

export interface Collected {
  root: Scope;
  symbols: Symbol[];
  refs: RefEntry[];
  skipped: Span[];
  problems: Diagnostic[];
}

const spanOf = (node: Node): Span => ({
  start: offset(node.source.startIdx),
  end: offset(node.source.endIdx),
});

function nameOf(node: RoleNode): {name: string; nameSpan: Span} | undefined {
  if (typeof node?.sourceString !== 'string' || node.isCorrection()) return undefined;
  const text: string = node.sourceString;
  const name = text.trim();
  if (name === '') return undefined;
  const start = node.source.startIdx + text.indexOf(name);
  return {name, nameSpan: {start: offset(start), end: offset(start + name.length)}};
}

function flatten(result: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(result)) for (const r of result) flatten(r, out);
  else if (result != null) out.push(result);
  return out;
}

/**
 * Walks the tree of a successful match, reading the roles attribute of each
 * nonterminal, and returns the scope tree with its declarations and references
 * in document order. Correction nodes are recorded as skipped input and not
 * entered.
 */
export function collect(semantics: Semantics, match: MatchResult, uri = ''): Collected {
  const root: Scope = {symbols: [], span: {start: offset(0), end: offset(match.input.length)}};
  const out: Collected = {root, symbols: [], refs: [], skipped: [], problems: []};
  const problem = (node: Node, code: string, message: string) =>
    out.problems.push({span: spanOf(node), severity: 'error', code, message});

  const rolesOf = (node: Node): Role[] => {
    let result: unknown;
    try {
      result = node[ROLES_ATTRIBUTE];
    } catch (e) {
      problem(node, 'roles.actionFailed', `Role action for '${node.ctorName}' failed: ${(e as Error).message}`);
      return [];
    }
    const found = flatten(result);
    const rs = found.filter(isRole);
    if (rs.length < found.length) {
      problem(node, 'roles.actionFailed', `Role action for '${node.ctorName}' returned a value that is not a role`);
    }
    return rs;
  };

  const walk = (node: Node, scope: Scope) => {
    if (node.isCorrection()) {
      out.skipped.push(spanOf(node));
      return;
    }
    const rs = node.isTerminal() || node.isIteration() ? [] : rolesOf(node);
    const own: Scope | undefined = rs.some(r => r.role === 'scope')
      ? {parent: scope, symbols: [], span: spanOf(node)}
      : undefined;
    for (const r of rs) {
      if (r.role === 'scope') continue;
      const id = nameOf(r.name);
      if (!id) {
        problem(node, 'roles.badName', `Role action for '${node.ctorName}' gave a name with no text`);
        continue;
      }
      if (r.role === 'declare') {
        const symbol: Symbol = {
          ...id,
          kind: r.kind,
          uri,
          scope,
          implicit: false,
          private: !!r.opts.private,
          visibleFrom: offset(r.opts.after ? node.source.endIdx : 0),
        };
        scope.symbols.push(symbol);
        out.symbols.push(symbol);
      } else {
        out.refs.push({...id, kinds: r.kinds, scope: own ?? scope, opts: r.opts, ownerEnd: offset(node.source.endIdx)});
      }
    }
    for (const child of node.children) walk(child, own ?? scope);
  };

  walk(semantics(match) as Node, root);
  return out;
}
