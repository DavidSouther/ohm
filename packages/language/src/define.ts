import type {Grammar, Node, Semantics} from 'ohm-js';

import {analyze} from './analysis.ts';
import {addRoles, roles as role} from './roles.ts';
import type {RoleAction} from './roles.ts';
import {createLanguageService} from './service.ts';
import type {LanguageService} from './service.ts';
import type {Analysis, DeclareOpts, RefOpts, Role, RoleNode, ServiceConfig} from './types.ts';

/** A semantic action as Ohm calls it. */
export type Action = (this: Node, ...children: Node[]) => unknown;

/** A pure function of an action's leading parameters that picks name nodes. */
export type Selector = (
  ...children: Node[]
) => RoleNode | readonly RoleNode[] | null | undefined;

/** A value, or a function of an action's parameters that computes it. */
export type FromChildren<T> = T | ((...children: Node[]) => T);

export interface WrapperDeclareOpts extends Omit<DeclareOpts, 'type' | 'data' | 'detail'> {
  type?: FromChildren<RoleNode | undefined>;
  data?: FromChildren<unknown>;
  detail?: FromChildren<string | undefined>;
}

export type Descriptor =
  | Readonly<{role: 'scope'}>
  | Readonly<{
      role: 'declare';
      select: Selector;
      kind: FromChildren<string>;
      opts: WrapperDeclareOpts;
    }>
  | Readonly<{role: 'ref'; select: Selector; kinds: string | string[]; opts: RefOpts}>;

/** Role descriptors composed around an optional action. */
export interface Wrapped {
  readonly descriptors: readonly Descriptor[];
  readonly action?: Action;
}

export type Inner = Action | Wrapped;

const isWrapped = (x: unknown): x is Wrapped =>
  typeof x === 'object' && x !== null && Array.isArray((x as Wrapped).descriptors);

function wrap<O extends object>(
  descriptor: (opts: O) => Descriptor,
  optsOrInner: O | Inner | undefined,
  inner: Inner | undefined
): Wrapped {
  const [opts, rest] =
    typeof optsOrInner === 'function' || isWrapped(optsOrInner)
      ? [{} as O, optsOrInner]
      : [optsOrInner ?? ({} as O), inner];
  const within: Wrapped = isWrapped(rest) ? rest : {descriptors: [], action: rest};
  return Object.freeze({
    descriptors: Object.freeze([descriptor(opts), ...within.descriptors]),
    action: within.action,
  });
}

export function scope(inner?: Inner): Wrapped {
  return wrap(() => ({role: 'scope'}), inner, undefined);
}

export function declare(
  select: Selector,
  kind: FromChildren<string>,
  optsOrInner?: WrapperDeclareOpts | Inner,
  inner?: Inner
): Wrapped {
  return wrap(opts => ({role: 'declare', select, kind, opts}), optsOrInner, inner);
}

export function ref(
  select: Selector,
  kinds: string | string[],
  optsOrInner?: RefOpts | Inner,
  inner?: Inner
): Wrapped {
  return wrap(opts => ({role: 'ref', select, kinds, opts}), optsOrInner, inner);
}

/** Nodes of `ruleName` below `node`, skipping corrections. */
export function descendants(node: Node, ruleName: string, out: Node[] = []): Node[] {
  for (const child of node.children) {
    if (child.isCorrection()) continue;
    if (child.ctorName === ruleName) out.push(child);
    descendants(child, ruleName, out);
  }
  return out;
}

export interface Language {
  readonly grammar: Grammar;
  readonly semantics: Semantics;
  operation(signature: string, rules: Record<string, Action | Wrapped>): Language;
  roles(table: Record<string, Wrapped | readonly Wrapped[]>): Language;
  analyze(text: string, uri?: string): Analysis;
  service(): LanguageService;
}

function computed<T>(value: FromChildren<T>, children: Node[]): T {
  return typeof value === 'function' ? (value as (...c: Node[]) => T)(...children) : value;
}

function selected(select: Selector, children: Node[]): RoleNode[] {
  return ([] as (RoleNode | null | undefined)[])
    .concat(select(...children) ?? [])
    .filter((n): n is RoleNode => n != null);
}

function rolesFor(d: Descriptor, children: Node[]): Role[] {
  if (d.role === 'scope') return [role.scope()];
  const names = selected(d.select, children);
  if (d.role === 'ref') return names.map(n => role.ref(n, d.kinds, d.opts));
  const kind = computed(d.kind, children);
  const opts: DeclareOpts = {
    ...d.opts,
    type: computed(d.opts.type, children),
    data: computed(d.opts.data, children),
    detail: computed(d.opts.detail, children),
  };
  return names.map(n => role.declare(n, kind, opts));
}

/** A stable text for comparing descriptors given in different operations. */
const keyOf = (descriptors: readonly Descriptor[]) =>
  JSON.stringify(descriptors, (_k, v) => (typeof v === 'function' ? String(v) : v));

/**
 * A language is a grammar with one semantics whose actions may be wrapped in
 * roles. Role descriptors are lifted statically into a roles attribute, so the
 * roles walk runs selectors only and never an action body.
 */
export function defineLanguage(grammar: Grammar, config: ServiceConfig): Language {
  const semantics = grammar.createSemantics();
  const table = new Map<string, {descriptors: readonly Descriptor[]; key: string}>();
  let fixed = false;

  /** The rule's arity from the grammar, which the lifted roles action must match. */
  const arityOf = (rule: string): number => {
    const info = grammar.rules[rule];
    if (!info) throw new Error(`Unknown rule '${rule}' in grammar ${grammar.name}`);
    return info.body.getArity();
  };

  const addDescriptors = (rule: string, descriptors: readonly Descriptor[]) => {
    if (descriptors.length === 0) return;
    if (fixed)
      throw new Error(`Cannot add roles for '${rule}' after the language analyzed text`);
    arityOf(rule);
    const key = keyOf(descriptors);
    const existing = table.get(rule);
    if (existing && existing.key !== key) {
      throw new Error(`Conflicting roles for rule '${rule}'`);
    }
    table.set(rule, {descriptors, key});
  };

  const lift = (rule: string, descriptors: readonly Descriptor[]): RoleAction => {
    const action = function (this: Node, ...children: Node[]) {
      return descriptors.flatMap(d => rolesFor(d, children));
    };
    return Object.defineProperty(action, 'length', {value: arityOf(rule)});
  };

  const fix = () => {
    if (fixed) return;
    const actions: Record<string, RoleAction> = {};
    for (const [rule, {descriptors}] of table) actions[rule] = lift(rule, descriptors);
    addRoles(semantics, actions);
    fixed = true;
  };

  const language: Language = {
    grammar,
    semantics,
    operation(signature, rules) {
      const actions: Record<string, Action> = {};
      for (const [rule, entry] of Object.entries(rules)) {
        const w: Wrapped = isWrapped(entry) ? entry : {descriptors: [], action: entry};
        addDescriptors(rule, w.descriptors);
        if (w.action) actions[rule] = w.action;
      }
      semantics.addOperation(signature, actions);
      return language;
    },
    roles(rolesTable) {
      for (const [rule, entry] of Object.entries(rolesTable)) {
        const ws: readonly Wrapped[] = isWrapped(entry) ? [entry] : entry;
        addDescriptors(
          rule,
          ws.flatMap(w => w.descriptors)
        );
      }
      return language;
    },
    analyze(text, uri = '') {
      fix();
      return analyze(semantics, config, uri, 0, text);
    },
    service() {
      fix();
      return createLanguageService(semantics, config);
    },
  };
  return language;
}
