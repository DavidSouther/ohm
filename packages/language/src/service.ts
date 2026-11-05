import type {Semantics} from 'ohm-js';

import {analyze, groupOf, lookup, namespaceOf} from './analysis.ts';
import type {
  Analysis,
  Offset,
  Reference,
  Scope,
  ServiceConfig,
  Span,
  Symbol,
  TextEdit,
} from './types.ts';

export interface LanguageService {
  open(uri: string, version: number, text: string): Analysis;
  change(uri: string, version: number, text: string): Analysis;
  close(uri: string): void;
  /** The last analysis that had a tree; `stale` when the latest text had none. */
  analysis(uri: string): {analysis: Analysis; stale: boolean} | undefined;
  documentSymbols(uri: string): Symbol[];
  definition(uri: string, at: Offset): Symbol[];
  references(uri: string, at: Offset, includeDeclaration: boolean): Span[];
  rename(uri: string, at: Offset, newName: string): TextEdit[];
  completion(uri: string, at: Offset): Symbol[];
}

interface DocState {
  good?: Analysis;
  stale: boolean;
}

const contains = (span: Span, at: number) => span.start <= at && at <= span.end;
const sameSpan = (a: Span, b: Span) => a.start === b.start && a.end === b.end;

/** The symbol that the name at `at` declares or refers to. */
function targetAt(a: Analysis, at: Offset): Symbol | undefined {
  const ref = a.references.find(r => contains(r.nameSpan, at));
  if (ref) return ref.target;
  return a.symbols.find(s => contains(s.nameSpan, at));
}

function usesOf(a: Analysis, target: Symbol): Reference[] {
  return a.references.filter(r => r.target === target);
}

function innermostScope(scope: Scope, at: Offset): Scope {
  const child = scope.children.find(c => contains(c.span, at));
  return child ? innermostScope(child, at) : scope;
}

export function createLanguageService(
  semantics: Semantics,
  config: ServiceConfig
): LanguageService {
  const docs = new Map<string, DocState>();

  const update = (uri: string, version: number, text: string): Analysis => {
    const latest = analyze(semantics, config, uri, version, text);
    if (latest.hasTree) docs.set(uri, {good: latest, stale: false});
    else docs.set(uri, {good: docs.get(uri)?.good, stale: true});
    return latest;
  };

  /** The analysis that positional queries may use: present and not stale. */
  const current = (uri: string): Analysis | undefined => {
    const doc = docs.get(uri);
    return doc && !doc.stale ? doc.good : undefined;
  };

  const references = (uri: string, at: Offset, includeDeclaration: boolean): Span[] => {
    const a = current(uri);
    const target = a && targetAt(a, at);
    if (!a || !target) return [];
    const spans = usesOf(a, target)
      .map(r => r.nameSpan)
      .filter(s => !sameSpan(s, target.nameSpan));
    if (includeDeclaration) spans.push(target.nameSpan);
    return spans.sort((x, y) => x.start - y.start);
  };

  return {
    open: update,
    change: update,
    close(uri) {
      docs.delete(uri);
    },
    analysis(uri) {
      const doc = docs.get(uri);
      return doc?.good && {analysis: doc.good, stale: doc.stale};
    },
    documentSymbols(uri) {
      return docs.get(uri)?.good?.symbols ?? [];
    },
    definition(uri, at) {
      const a = current(uri);
      const target = a && targetAt(a, at);
      return target ? [target] : [];
    },
    references,
    rename(uri, at, newName) {
      const a = current(uri);
      const target = a && targetAt(a, at);
      if (!a || !target) return [];
      const kinds = namespaceOf(config, groupOf(config, target.kind));
      const scopes = [target.scope, ...usesOf(a, target).map(r => r.scope)];
      if (scopes.some(s => lookup(s, newName, kinds, Infinity))) return [];
      return references(uri, at, true).map(span => ({uri, span, newText: newName}));
    },
    completion(uri, at) {
      const a = current(uri);
      if (!a) return [];
      const seen = new Set<string>();
      const out: Symbol[] = [];
      for (let s: Scope | undefined = innermostScope(a.root, at); s; s = s.parent) {
        for (const sym of s.symbols) {
          if (sym.visibleFrom <= at && !seen.has(sym.name)) {
            seen.add(sym.name);
            out.push(sym);
          }
        }
      }
      return out;
    },
  };
}
