import type {Grammar, MatchResult, RecoveredFailure, Semantics} from 'ohm-js';

import {createResolver, groupOf} from './resolve.ts';
import type {Outer, Resolution} from './resolve.ts';
import {offset} from './types.ts';
import type {
  Analysis,
  Diagnostic,
  Reference,
  ServiceConfig,
  Span,
  Definition,
} from './types.ts';
import {collect} from './walk.ts';
import type {Collected, RefEntry} from './walk.ts';

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
    imports: [],
  };
}

function duplicates(config: ServiceConfig, symbols: Definition[]): Diagnostic[] {
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
 * Binds each import: a reference per imported name that targets the other
 * module's export, and an alias in the root scope so uses resolve through it.
 */
function bindImports(
  found: Collected,
  outer: Outer | undefined,
  hasSkippedInput: boolean
): {references: Reference[]; diagnostics: Diagnostic[]; imports: string[]} {
  const references: Reference[] = [];
  const diagnostics: Diagnostic[] = [];
  const imports: string[] = [];
  const severity = hasSkippedInput ? 'hint' : 'error';
  for (const imp of found.imports) {
    const target = outer?.resolveImport(imp.spec, found.uri);
    if (!target) {
      diagnostics.push({
        span: imp.specSpan,
        severity,
        code: 'import.unresolved',
        message: `Cannot resolve module ${imp.spec}`,
      });
      continue;
    }
    imports.push(target);
    const exported = outer?.exportsOf(target);
    for (const n of imp.names) {
      const def = exported?.find(d => d.name === n.name);
      references.push({
        name: n.name,
        kinds: def ? [def.kind] : [],
        nameSpan: n.nameSpan,
        scope: found.root,
        target: def,
        status: def ? 'resolved' : exported ? 'undefined' : 'uncertain',
      });
      if (def) {
        found.root.symbols.push({
          name: n.name,
          kind: def.kind,
          nameSpan: n.nameSpan,
          uri: found.uri,
          scope: found.root,
          implicit: false,
          private: false,
          visibleFrom: offset(0),
          aliasOf: def,
        });
      } else if (exported) {
        diagnostics.push({
          span: n.nameSpan,
          severity,
          code: 'import.missing',
          message: `Module ${imp.spec} has no export '${n.name}'`,
        });
      }
    }
  }
  return {references, diagnostics, imports};
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
  text: string,
  outer?: Outer
): Analysis {
  const match = grammarOf(semantics).match(text, config.start, {recover: true});
  if (match.failed()) return noTree(uri, version, text, match);

  const found = collect(semantics, match, uri);
  const syntax = match.getRecoveredFailures().map(syntaxDiagnostic);
  const hasSkippedInput = syntax.length > 0 || found.skipped.length > 0;
  const symbols = [...found.symbols];
  const bound = bindImports(found, outer, hasSkippedInput);
  const diagnostics: Diagnostic[] = [...syntax, ...found.problems, ...bound.diagnostics];

  const resolve = createResolver(found, config, hasSkippedInput, symbols, outer);

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
  const references = [...bound.references, ...found.refs.map(reference)];

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
    imports: bound.imports,
  };
}
