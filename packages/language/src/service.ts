import type {Semantics} from 'ohm-js';

import {analyze} from './analysis.ts';
import {groupOf, lookup, namespaceOf} from './resolve.ts';
import type {Outer} from './resolve.ts';
import {offset} from './types.ts';
import type {
  Analysis,
  Definition,
  Location,
  Offset,
  Scope,
  ServiceConfig,
  Span,
  TextEdit,
} from './types.ts';
import {createOverlayVfs} from './vfs.ts';

export interface LanguageService {
  open(uri: string, version: number, text: string): Analysis;
  change(uri: string, version: number, text: string): Analysis;
  /** Drops an open document. A file the workspace can still read stays known, from its saved text. */
  close(uri: string): Promise<void>;
  /**
   * Analyzes every workspace file that is not yet known, so names resolve
   * across files regardless of which were opened. It streams: each yielded URI
   * has a current analysis, and a URI may come again when a second pass
   * reanalyzes it against files that were found after it.
   */
  scan(): AsyncGenerator<string, void>;
  /** Re-reads `uri` from the open documents or the workspace files and analyzes it again. */
  refresh(uri: string): Promise<Analysis | undefined>;
  /** Other documents whose analysis may differ now that `uri` last changed. */
  affected(uri: string): string[];
  /** The last analysis that had a tree; `stale` when the latest text had none. */
  analysis(uri: string): {analysis: Analysis; stale: boolean} | undefined;
  documentSymbols(uri: string): Definition[];
  definition(uri: string, at: Offset): Definition[];
  references(uri: string, at: Offset, includeDeclaration: boolean): Location[];
  /** The name at `at` that a rename would start from, or undefined when it cannot be renamed. */
  prepareRename(uri: string, at: Offset): {span: Span; placeholder: string} | undefined;
  rename(uri: string, at: Offset, newName: string): TextEdit[];
  completion(uri: string, at: Offset): Definition[];
}

interface DocState {
  good?: Analysis;
  stale: boolean;
  version: number;
  /** Changes when the definitions other documents can see change. */
  exportsKey: string;
  /** Set by an update that changed the exports; cleared when `affected` reports it. */
  exportsChanged: boolean;
}

const contains = (span: Span, at: number) => span.start <= at && at <= span.end;
const sameSpan = (a: Span, b: Span) => a.start === b.start && a.end === b.end;

/** Identifies a definition across analyses, which build fresh objects each time. */
const keyOf = (d: Definition) => `${d.uri}#${d.nameSpan.start}/${d.kind}/${d.name}`;

/** The symbol that the name at `at` declares or refers to. */
function targetAt(a: Analysis, at: Offset): Definition | undefined {
  const ref = a.references.find(r => contains(r.nameSpan, at));
  if (ref) return ref.target;
  return a.symbols.find(s => contains(s.nameSpan, at));
}

function innermostScope(scope: Scope, at: Offset): Scope {
  // Half open, so a position shared by two adjacent scopes belongs to the later one.
  const child = scope.children.find(c => c.span.start <= at && at < c.span.end);
  return child ? innermostScope(child, at) : scope;
}

/** An analysis that failed outright: no tree, and one diagnostic saying why. */
function failedAnalysis(uri: string, version: number, text: string, e: unknown): Analysis {
  const at = offset(0);
  return {
    uri,
    version,
    text,
    hasTree: false,
    root: {symbols: [], children: [], span: {start: at, end: offset(text.length)}},
    symbols: [],
    references: [],
    diagnostics: [
      {
        span: {start: at, end: at},
        severity: 'error',
        code: 'roles.internal',
        message: `Analysis failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    ],
    hasSkippedInput: true,
    imports: [],
  };
}

function safeAnalyze(
  semantics: Semantics,
  config: ServiceConfig,
  uri: string,
  version: number,
  text: string,
  outer?: Outer
): Analysis {
  try {
    return analyze(semantics, config, uri, version, text, outer);
  } catch (e) {
    return failedAnalysis(uri, version, text, e);
  }
}

export function createLanguageService(
  semantics: Semantics,
  config: ServiceConfig
): LanguageService {
  const docs = new Map<string, DocState>();
  /** Scans in progress; while any runs, an unresolved name is only uncertain. */
  let scanning = 0;
  /** Set when a document was analyzed during a scan, so the scan reanalyzes it at the end. */
  let analyzedUnsettled = false;
  const workspace = config.workspace;
  const vfs = createOverlayVfs(workspace?.vfs);

  const sameGroup = (a: string, b: string) =>
    !workspace?.group || workspace.group(a) === workspace.group(b);

  const exportable = (d: Definition) =>
    !!workspace && !d.implicit && !d.external && !d.aliasOf && workspace.exported(d);

  const exportsOf = (uri: string): Definition[] | undefined =>
    docs.get(uri)?.good?.symbols.filter(exportable);

  let index: Map<string, Definition[]> | undefined;
  const exportIndex = () => {
    if (!index) {
      index = new Map();
      for (const uri of docs.keys()) {
        for (const d of exportsOf(uri) ?? [])
          index.set(d.name, [...(index.get(d.name) ?? []), d]);
      }
    }
    return index;
  };

  const outer: Outer | undefined = workspace && {
    ambient: (name, kinds, fromUri) =>
      workspace.mode === 'ambient'
        ? exportIndex()
            .get(name)
            ?.find(
              d => d.uri !== fromUri && sameGroup(d.uri, fromUri) && kinds.includes(d.kind)
            )
        : undefined,
    resolveImport: (spec, fromUri) => workspace.resolveImport?.(spec, fromUri),
    exportsOf,
    settled: () => scanning === 0,
  };

  const update = (uri: string, version: number, text: string): Analysis => {
    if (scanning > 0) analyzedUnsettled = true;
    const latest = safeAnalyze(semantics, config, uri, version, text, outer);
    const before = docs.get(uri);
    if (latest.hasTree) {
      const good = latest.symbols.filter(exportable);
      const exportsKey = good.map(keyOf).join('\n');
      docs.set(uri, {
        good: latest,
        stale: false,
        version,
        exportsKey,
        exportsChanged: !!before?.exportsChanged || before?.exportsKey !== exportsKey,
      });
    } else {
      docs.set(uri, {
        good: before?.good,
        stale: true,
        version,
        exportsKey: before?.exportsKey ?? '',
        exportsChanged: !!before?.exportsChanged,
      });
    }
    index = undefined;
    return latest;
  };

  /** The analysis that positional queries may use: present and not stale. */
  const current = (uri: string): Analysis | undefined => {
    const doc = docs.get(uri);
    return doc && !doc.stale ? doc.good : undefined;
  };

  const lookupAt = (uri: string, at: Offset) => {
    const a = current(uri);
    const target = a && targetAt(a, at);
    return a && target ? {a, target} : undefined;
  };

  /** Every use of `target` in any known document, found by definition key. */
  const usesOf = (target: Definition) => {
    const key = keyOf(target);
    const out: {a: Analysis; span: Span; scope: Scope}[] = [];
    for (const doc of docs.values()) {
      for (const r of doc.good?.references ?? []) {
        if (r.target && keyOf(r.target) === key) {
          out.push({a: doc.good!, span: r.nameSpan, scope: r.scope});
        }
      }
    }
    return out;
  };

  const references = (uri: string, at: Offset, includeDeclaration: boolean): Location[] => {
    const found = lookupAt(uri, at);
    if (!found) return [];
    const {target} = found;
    const out: Location[] = usesOf(target)
      .map(u => ({uri: u.a.uri, span: u.span}))
      .filter(l => !(l.uri === target.uri && sameSpan(l.span, target.nameSpan)));
    if (includeDeclaration && !target.external) {
      out.push({uri: target.uri, span: target.nameSpan});
    }
    return out.sort((x, y) =>
      x.uri < y.uri ? -1 : x.uri > y.uri ? 1 : x.span.start - y.span.start
    );
  };

  return {
    open(uri, version, text) {
      vfs.set(uri, text);
      return update(uri, version, text);
    },
    change(uri, version, text) {
      vfs.set(uri, text);
      return update(uri, version, text);
    },
    async close(uri) {
      vfs.delete(uri);
      const saved = await vfs.read(uri);
      // Opened again while the file was being read: that open owns the state.
      if (vfs.has(uri)) return;
      if (saved === undefined) {
        docs.delete(uri);
        index = undefined;
      } else {
        update(uri, docs.get(uri)?.version ?? 0, saved);
      }
    },
    async *scan() {
      if (scanning === 0) analyzedUnsettled = false;
      scanning++;
      try {
        const texts = new Map<string, string>();
        for await (const uri of vfs.list()) {
          if (docs.has(uri)) continue;
          const text = await vfs.read(uri);
          // Gone since it was listed, or opened while it was being read.
          if (text === undefined || docs.has(uri)) continue;
          texts.set(uri, text);
          update(uri, 0, text);
          yield uri;
        }
        if (texts.size === 0 && !analyzedUnsettled) return;
        // A second pass, so a file loaded early sees the exports of one loaded after it,
        // and so do the documents that were analyzed before the files were known.
        scanning--;
        try {
          for (const uri of [...docs.keys()]) {
            const text = texts.get(uri) ?? (await vfs.read(uri));
            if (text === undefined || !docs.has(uri)) continue;
            update(uri, docs.get(uri)?.version ?? 0, text);
            yield uri;
          }
        } finally {
          scanning++;
        }
      } finally {
        scanning--;
      }
    },
    async refresh(uri) {
      const wasOpen = vfs.has(uri);
      const text = await vfs.read(uri);
      if (text === undefined) {
        docs.delete(uri);
        index = undefined;
        return undefined;
      }
      // Opened while the file was being read: the open document's analysis is newer.
      if (!wasOpen && vfs.has(uri)) return docs.get(uri)?.good;
      return update(uri, docs.get(uri)?.version ?? 0, text);
    },
    affected(uri) {
      const doc = docs.get(uri);
      if (!workspace || !doc?.exportsChanged) return [];
      // Read once: the next call has nothing new unless the exports change again.
      doc.exportsChanged = false;
      return [...docs.keys()].filter(other => {
        if (other === uri || !sameGroup(other, uri)) return false;
        return workspace.mode === 'ambient' || !!docs.get(other)?.good?.imports.includes(uri);
      });
    },
    analysis(uri) {
      const doc = docs.get(uri);
      return doc?.good && {analysis: doc.good, stale: doc.stale};
    },
    documentSymbols(uri) {
      return docs.get(uri)?.good?.symbols ?? [];
    },
    definition(uri, at) {
      const found = lookupAt(uri, at);
      return found && !found.target.external ? [found.target] : [];
    },
    references,
    prepareRename(uri, at) {
      const found = lookupAt(uri, at);
      if (!found || found.target.external) return undefined;
      const here = found.a.references.find(r => contains(r.nameSpan, at));
      return {
        span: here ? here.nameSpan : found.target.nameSpan,
        placeholder: found.target.name,
      };
    },
    rename(uri, at, newName) {
      if (newName === '' || /\s/.test(newName)) return [];
      const found = lookupAt(uri, at);
      if (!found || found.target.external) return [];
      const {target} = found;
      // A document with no tree has references that cannot be seen, so a rename could miss one.
      if ([...docs.values()].some(doc => doc.stale)) return [];
      const kinds = namespaceOf(config, groupOf(config, target.kind));
      const scopes = [target.scope, ...usesOf(target).map(u => u.scope)];
      if (scopes.some(s => lookup(s, newName, kinds, Infinity))) return [];
      if (outer?.ambient(newName, kinds, target.uri)) return [];
      return references(uri, at, true).map(l => ({
        uri: l.uri,
        span: l.span,
        newText: newName,
      }));
    },
    completion(uri, at) {
      const a = current(uri);
      if (!a) return [];
      const seen = new Set<string>();
      const out: Definition[] = [];
      const offer = (sym: Definition) => {
        const key = `${sym.kind}/${sym.name}`;
        if (sym.visibleFrom <= at && !seen.has(key)) {
          seen.add(key);
          out.push(sym);
        }
      };
      for (let s: Scope | undefined = innermostScope(a.root, at); s; s = s.parent) {
        s.symbols.forEach(offer);
      }
      if (workspace?.mode === 'ambient') {
        for (const defs of exportIndex().values())
          defs.filter(d => d.uri !== uri && sameGroup(d.uri, uri)).forEach(offer);
      }
      return out;
    },
  };
}
