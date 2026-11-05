import type {Grammar, MatchResult, RecoveredFailure, Semantics} from 'ohm-js';

import {isRole} from './roles.ts';
import {offset} from './types.ts';
import type {
  Analysis,
  RefStatus,
  Diagnostic,
  ExternalSymbol,
  Reference,
  Role,
  RoleNode,
  Scope,
  ServiceConfig,
  Span,
  Symbol,
} from './types.ts';
import {collect, nodeKey} from './walk.ts';
import type {RefEntry} from './walk.ts';

function grammarOf(semantics: Semantics): Grammar {
  const {getGrammar} = semantics as Semantics & {getGrammar?: () => Grammar};
  if (typeof getGrammar !== 'function') throw new TypeError('Expected an Ohm Semantics');
  return getGrammar.call(semantics);
}

function syntaxDiagnostic(f: RecoveredFailure): Diagnostic {
  const {startIdx, endIdx} = f.interval;
  const span: Span =
    startIdx < endIdx
      ? {start: offset(startIdx), end: offset(endIdx)}
      : {start: offset(f.position), end: offset(f.position)};
  return {
    span,
    severity: 'error',
    code: 'syntax.expected',
    message: `Expected ${f.getExpectedText()}`,
  };
}

function noTree(uri: string, version: number, text: string, match: MatchResult): Analysis {
  return {
    uri,
    version,
    text,
    hasTree: false,
    root: {symbols: [], children: [], span: {start: offset(0), end: offset(text.length)}},
    symbols: [],
    references: [],
    diagnostics: match.getRecoveredFailures().map(syntaxDiagnostic),
    hasSkippedInput: true,
  };
}

/** Kinds that share a lookup space and a duplicate group with `kind`. */
export function namespaceOf(config: ServiceConfig, kind: string): string[] {
  return config.namespaces?.[kind] ?? [kind];
}

export function groupOf(config: ServiceConfig, kind: string): string {
  const entry = Object.entries(config.namespaces ?? {}).find(([, kinds]) =>
    kinds.includes(kind)
  );
  return entry ? entry[0] : kind;
}

const matches = (d: Symbol, name: string, kinds: readonly string[], at: number) =>
  d.name === name && kinds.includes(d.kind) && at >= d.visibleFrom;

export function lookup(
  scope: Scope | undefined,
  name: string,
  kinds: readonly string[],
  at: number
): Symbol | undefined {
  for (let s = scope; s; s = s.parent) {
    const hit = s.symbols.find(d => matches(d, name, kinds, at));
    if (hit) return hit;
  }
  return undefined;
}

/** A member of `container` reachable from outside it: never a private one. */
function member(container: Symbol, name: string, kinds: readonly string[]) {
  return container.members?.symbols.find(d => matches(d, name, kinds, Infinity) && !d.private);
}

function duplicates(config: ServiceConfig, symbols: Symbol[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const scope of new Set(symbols.map(s => s.scope))) {
    const seen = new Set<string>();
    for (const s of scope.symbols) {
      const key = `${groupOf(config, s.kind)}/${s.name}`;
      if (seen.has(key) && !s.implicit) {
        out.push({
          span: s.nameSpan,
          severity: 'error',
          code: 'def.duplicate',
          message: `Duplicate ${s.kind} '${s.name}'`,
        });
      }
      seen.add(key);
    }
  }
  return out;
}

function unresolvedDiagnostic(
  r: RefEntry,
  {status, container}: Resolution
): Diagnostic | undefined {
  const what = `${r.kinds.join(' or ')} '${r.name}'`;
  if (status === 'undefinedMember' && container) {
    return {
      span: r.nameSpan,
      severity: 'error',
      code: 'ref.undefinedMember',
      message: `No ${what} in ${container.kind} '${container.name}'`,
    };
  }
  if (status === 'undefined') {
    return {
      span: r.nameSpan,
      severity: 'error',
      code: 'ref.undefined',
      message: `Undefined ${what}`,
    };
  }
  if (status === 'uncertain') {
    return {
      span: r.nameSpan,
      severity: 'hint',
      code: 'ref.uncertain',
      message: `Cannot find ${what}; part of the document could not be parsed`,
    };
  }
  return undefined;
}

interface Resolution {
  status: RefStatus;
  target?: Symbol;
  /** For `undefinedMember`, the symbol that has no such member. */
  container?: Symbol;
}

/**
 * Parses `text` with recovery and resolves its roles. Refs resolve in document
 * order, innermost scope first, so an `orDeclare` re-assignment finds the
 * symbol its first occurrence declared.
 */
export function analyze(
  semantics: Semantics,
  config: ServiceConfig,
  uri: string,
  version: number,
  text: string
): Analysis {
  const match = grammarOf(semantics).match(text, config.start, {recover: true});
  if (match.failed()) return noTree(uri, version, text, match);

  const found = collect(semantics, match, uri);
  const syntax = match.getRecoveredFailures().map(syntaxDiagnostic);
  const hasSkippedInput = syntax.length > 0 || found.skipped.length > 0;
  const symbols = [...found.symbols];
  const diagnostics: Diagnostic[] = [...syntax, ...found.problems];

  const byRole = new Map<Role, RefEntry>();
  const byNode = new Map<string, RefEntry>();
  for (const r of found.refs) {
    byRole.set(r.role, r);
    if (!byNode.has(r.ownerKey)) byNode.set(r.ownerKey, r);
    if (!byNode.has(r.nameKey)) byNode.set(r.nameKey, r);
  }
  /** The ref that a node (by its producing node or its name node) or a role stands for. */
  const refOf = (x: RoleNode | Role) => (isRole(x) ? byRole.get(x) : byNode.get(nodeKey(x)));

  const externals = new Map<string, Symbol>();
  const external = (kind: string, name: string, info: ExternalSymbol, owner = ''): Symbol => {
    const key = `${owner}/${kind}/${name}`;
    let symbol = externals.get(key);
    if (!symbol) {
      symbol = {
        name,
        kind,
        nameSpan: {start: offset(0), end: offset(0)},
        uri,
        scope: found.root,
        implicit: false,
        private: false,
        visibleFrom: offset(0),
        external: info,
      };
      externals.set(key, symbol);
    }
    return symbol;
  };

  const viaMember = (r: RefEntry, kinds: string[], via: RoleNode | Role): Resolution => {
    const viaRef = refOf(via);
    const container = viaRef && resolve(viaRef).target;
    if (!container) return {status: 'silent'};
    const type = found.types.get(container);
    const typeRef = type && refOf(type);
    const typed = type ? typeRef && resolve(typeRef).target : container;
    if (!typed) return {status: 'silent'};
    const target = typed.external
      ? typed.external.members?.includes(r.name)
        ? external(kinds[0], r.name, {}, typed.name)
        : undefined
      : member(typed, r.name, kinds);
    return target
      ? {status: 'resolved', target}
      : {status: 'undefinedMember', container: typed};
  };

  const lexical = (r: RefEntry, kinds: string[]): Resolution => {
    let target = lookup(r.scope, r.name, kinds, r.nameSpan.start);
    if (!target && r.opts.external) {
      for (const kind of r.kinds) {
        const info = config.external?.[kind]?.(r.name);
        if (info) {
          target = external(kind, r.name, info);
          break;
        }
      }
    }
    if (!target && r.opts.orDeclare) {
      target = {
        name: r.name,
        kind: r.opts.orDeclare,
        nameSpan: r.nameSpan,
        uri,
        scope: r.scope,
        implicit: true,
        private: !!r.opts.private,
        visibleFrom: r.opts.after ? r.ownerEnd : offset(0),
      };
      r.scope.symbols.push(target);
      symbols.push(target);
    }
    if (target) return {status: 'resolved', target};
    return {status: hasSkippedInput ? 'uncertain' : 'undefined'};
  };

  const memo = new Map<RefEntry, Resolution>();
  function resolve(r: RefEntry): Resolution {
    const known = memo.get(r);
    if (known) return known;
    memo.set(r, {status: 'silent'});
    const kinds = r.kinds.flatMap(k => namespaceOf(config, k));
    const resolution = r.via ? viaMember(r, kinds, r.via) : lexical(r, kinds);
    memo.set(r, resolution);
    return resolution;
  }

  const reference = (r: RefEntry): Reference => {
    const resolution = resolve(r);
    const unresolved = unresolvedDiagnostic(r, resolution);
    if (unresolved) diagnostics.push(unresolved);
    return {
      name: r.name,
      kinds: r.kinds,
      nameSpan: r.nameSpan,
      scope: r.scope,
      target: resolution.target,
      status: resolution.status,
    };
  };
  const references = found.refs.map(reference);

  diagnostics.push(...duplicates(config, symbols));
  const byStart = (a: {start: number}, b: {start: number}) => a.start - b.start;
  symbols.sort((a, b) => byStart(a.nameSpan, b.nameSpan));
  diagnostics.sort((a, b) => byStart(a.span, b.span));
  return {
    uri,
    version,
    text,
    hasTree: true,
    root: found.root,
    symbols,
    references,
    diagnostics,
    hasSkippedInput,
  };
}
