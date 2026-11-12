import {isRole} from './roles.ts';
import {offset} from './types.ts';
import type {
  ExternalSymbol,
  RefStatus,
  Role,
  RoleNode,
  Scope,
  ServiceConfig,
  Definition,
} from './types.ts';
import {nodeKey} from './walk.ts';
import type {Collected, RefEntry} from './walk.ts';

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

const matches = (d: Definition, name: string, kinds: readonly string[], at: number) =>
  d.name === name && kinds.includes(d.kind) && at >= d.visibleFrom;

export function lookup(
  scope: Scope | undefined,
  name: string,
  kinds: readonly string[],
  at: number
): Definition | undefined {
  for (let s = scope; s; s = s.parent) {
    const hit = s.symbols.find(d => matches(d, name, kinds, at));
    if (hit) return hit;
  }
  return undefined;
}

/** A member of `container` reachable from outside it: never a private one. */
function member(container: Definition, name: string, kinds: readonly string[]) {
  return container.members?.symbols.find(d => matches(d, name, kinds, Infinity) && !d.private);
}

/** What a document can learn about the files around it. */
export interface Outer {
  /** An exported definition of another document, for ambient languages. */
  ambient(name: string, kinds: readonly string[], fromUri: string): Definition | undefined;
  resolveImport(specifier: string, fromUri: string): string | undefined;
  /** The exported definitions of a loaded document, or undefined when it is not loaded. */
  exportsOf(uri: string): Definition[] | undefined;
  /** False while the workspace's files are still being loaded, so a missing name may yet appear. */
  settled(): boolean;
}

export interface Resolution {
  status: RefStatus;
  target?: Definition;
  /** For `undefinedMember`, the symbol that has no such member. */
  container?: Definition;
}

/**
 * Returns a memoized resolver for the refs of one document. Lexical refs walk
 * enclosing scopes innermost first, then host resolvers, then `orDeclare`,
 * which adds an implicit symbol to `symbols`. A `via` ref looks the name up
 * among its target's members, through the target's type when it has one.
 */
export function createResolver(
  found: Collected,
  config: ServiceConfig,
  hasSkippedInput: boolean,
  symbols: Definition[],
  outer?: Outer
): (r: RefEntry) => Resolution {
  const byRole = new Map<Role, RefEntry>();
  const byNode = new Map<string, RefEntry>();
  for (const r of found.refs) {
    byRole.set(r.role, r);
    if (!byNode.has(r.ownerKey)) byNode.set(r.ownerKey, r);
    if (!byNode.has(r.nameKey)) byNode.set(r.nameKey, r);
  }
  /** The ref that a node (by its producing node or its name node) or a role stands for. */
  const refOf = (x: RoleNode | Role) => (isRole(x) ? byRole.get(x) : byNode.get(nodeKey(x)));

  const externals = new Map<string, Definition>();
  const external = (
    kind: string,
    name: string,
    info: ExternalSymbol,
    owner = ''
  ): Definition => {
    const key = `${owner}/${kind}/${name}`;
    let symbol = externals.get(key);
    if (!symbol) {
      symbol = {
        name,
        kind,
        nameSpan: {start: offset(0), end: offset(0)},
        uri: found.uri,
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
    if (target?.aliasOf) target = target.aliasOf;
    if (!target) target = outer?.ambient(r.name, kinds, found.uri);
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
        uri: found.uri,
        scope: r.scope,
        implicit: true,
        private: !!r.opts.private,
        visibleFrom: r.opts.after ? r.ownerEnd : offset(0),
      };
      r.scope.symbols.push(target);
      symbols.push(target);
    }
    if (target) return {status: 'resolved', target};
    return {
      status: hasSkippedInput || (outer && !outer.settled()) ? 'uncertain' : 'undefined',
    };
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
  return resolve;
}
