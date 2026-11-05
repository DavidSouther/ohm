import type {Grammar, MatchResult, RecoveredFailure, Semantics} from 'ohm-js';

import {createResolver, groupOf} from './resolve.ts';
import type {Resolution} from './resolve.ts';
import {offset} from './types.ts';
import type {Analysis, Diagnostic, Reference, ServiceConfig, Span, Symbol} from './types.ts';
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

  const resolve = createResolver(found, config, hasSkippedInput, symbols);

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
