import type {Grammar, MatchResult, RecoveredFailure, Semantics} from 'ohm-js';

import {offset} from './types.ts';
import type {
  Analysis,
  RefStatus,
  Diagnostic,
  Reference,
  Scope,
  ServiceConfig,
  Span,
  Symbol,
} from './types.ts';
import {collect} from './walk.ts';
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
function namespaceOf(config: ServiceConfig, kind: string): string[] {
  return config.namespaces?.[kind] ?? [kind];
}

function groupOf(config: ServiceConfig, kind: string): string {
  const entry = Object.entries(config.namespaces ?? {}).find(([, kinds]) =>
    kinds.includes(kind)
  );
  return entry ? entry[0] : kind;
}

export function lookup(
  scope: Scope | undefined,
  name: string,
  kinds: readonly string[],
  at: number
): Symbol | undefined {
  for (let s = scope; s; s = s.parent) {
    const hit = s.symbols.find(
      d => d.name === name && kinds.includes(d.kind) && at >= d.visibleFrom
    );
    if (hit) return hit;
  }
  return undefined;
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

function unresolvedDiagnostic(r: RefEntry, status: RefStatus): Diagnostic | undefined {
  const what = `${r.kinds.join(' or ')} '${r.name}'`;
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

  const resolve = (r: RefEntry): Reference => {
    const kinds = r.kinds.flatMap(k => namespaceOf(config, k));
    let target = lookup(r.scope, r.name, kinds, r.nameSpan.start);
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
    const status = target ? 'resolved' : hasSkippedInput ? 'uncertain' : 'undefined';
    const unresolved = unresolvedDiagnostic(r, status);
    if (unresolved) diagnostics.push(unresolved);
    return {
      name: r.name,
      kinds: r.kinds,
      nameSpan: r.nameSpan,
      scope: r.scope,
      target,
      status,
    };
  };
  const references = found.refs.map(resolve);

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
