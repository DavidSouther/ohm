import type {Semantics} from 'ohm-js';

import type {DeclareOpts, RefOpts, Role, RoleNode} from './types.ts';

/** The attribute that `addRoles` registers; the walker reads it on every nonterminal. */
export const ROLES_ATTRIBUTE = 'roles';

export const roles = {
  scope(): Role {
    return Object.freeze({role: 'scope'});
  },
  declare(name: RoleNode, kind: string, opts: DeclareOpts = {}): Role {
    return Object.freeze({role: 'declare', name, kind, opts: Object.freeze({...opts})});
  },
  ref(name: RoleNode, kinds: string | string[], opts: RefOpts = {}): Role {
    return Object.freeze({
      role: 'ref',
      name,
      kinds: Object.freeze(([] as string[]).concat(kinds)),
      opts: Object.freeze({...opts}),
    });
  },
};

export type RoleResult = Role | readonly RoleResult[] | null | undefined | void;

export type RoleAction = (this: RoleNode, ...children: RoleNode[]) => RoleResult;

export type RoleActions = Record<string, RoleAction>;

/**
 * Registers the role actions as an attribute of `semantics`. Rules without an
 * action yield no roles; Ohm checks each action's arity here.
 */
export function addRoles(semantics: Semantics, actions: RoleActions): void {
  semantics.addAttribute<RoleResult>(ROLES_ATTRIBUTE, {
    _nonterminal() {},
    _iter() {},
    _terminal() {},
    ...actions,
  });
}

const ROLE_NAMES = new Set(['scope', 'declare', 'ref']);

export function isRole(x: unknown): x is Role {
  return (
    typeof x === 'object' &&
    x !== null &&
    ROLE_NAMES.has((x as {role?: unknown}).role as string)
  );
}
