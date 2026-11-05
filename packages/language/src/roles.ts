import type {Semantics} from 'ohm-js';

import type {DeclareOpts, RefOpts, Role, RoleNode} from './types.ts';

export const roles = {
  scope(): Role {
    throw new Error('not implemented');
  },
  declare(_name: RoleNode, _kind: string, _opts: DeclareOpts = {}): Role {
    throw new Error('not implemented');
  },
  ref(_name: RoleNode, _kinds: string | string[], _opts: RefOpts = {}): Role {
    throw new Error('not implemented');
  },
};

export type RoleResult = Role | readonly RoleResult[] | null | undefined | void;

export type RoleAction = (this: RoleNode, ...children: RoleNode[]) => RoleResult;

export type RoleActions = Record<string, RoleAction>;

export function addRoles(_semantics: Semantics, _actions: RoleActions): void {
  throw new Error('not implemented');
}
