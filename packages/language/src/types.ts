import type {Node} from 'ohm-js';

declare const offsetBrand: unique symbol;

/** A UTF-16 code unit index into a document's text. */
export type Offset = number & {readonly [offsetBrand]: true};

export const offset = (n: number): Offset => n as Offset;

export interface Span {
  start: Offset;
  end: Offset;
}

export type RoleNode = Node;

export interface DeclareOpts {
  /** Bind in the scope enclosing the nearest scope-opening node; members are that node's scope. */
  hoist?: boolean;
  after?: boolean;
  /** A node or role whose reference gives this symbol's type, for member lookup. */
  type?: RoleNode | Role;
  private?: boolean;
  detail?: string;
  doc?: string;
  data?: unknown;
}

/** Roles bound with `as` by an ancestor or an earlier role on the same node. */
export type RoleContext = Readonly<Record<string, Role>>;

export interface RefOpts {
  /** Resolve this first, then look the name up among its members. */
  via?: RoleNode | Role | ((ctx: RoleContext) => RoleNode | Role | undefined);
  orDeclare?: string;
  after?: boolean;
  external?: boolean;
  private?: boolean;
  /** Binds this role into the context of later roles on the node and of descendants. */
  as?: string;
}

export type Role =
  | Readonly<{role: 'scope'}>
  | Readonly<{role: 'declare'; name: RoleNode; kind: string; opts: DeclareOpts}>
  | Readonly<{role: 'ref'; name: RoleNode; kinds: readonly string[]; opts: RefOpts}>;

/** A symbol defined outside any document, such as a builtin chip or an OS class. */
export interface ExternalSymbol {
  members?: readonly string[];
}

export interface ServiceConfig {
  start: string;
  namespaces?: Record<string, string[]>;
  /** Host resolvers by kind, asked when a ref with `external` finds nothing in the document. */
  external?: Record<string, (name: string) => ExternalSymbol | undefined>;
}

export interface Scope {
  parent?: Scope;
  children: Scope[];
  symbols: Definition[];
  span: Span;
}

export interface Definition {
  name: string;
  kind: string;
  nameSpan: Span;
  /** The whole node that declares this definition, for outlines and folding. */
  span?: Span;
  uri: string;
  scope: Scope;
  implicit: boolean;
  private: boolean;
  /** The symbol is visible to references that start at or after this offset. */
  visibleFrom: Offset;
  /** Declarations reachable through `via`, for a symbol whose node opens a scope. */
  members?: Scope;
  /** Set for a symbol supplied by a host resolver; it has no location. */
  external?: ExternalSymbol;
  detail?: string;
  doc?: string;
  data?: unknown;
}

/**
 * `silent` is a `via` ref whose target, or the target's type, did not resolve;
 * it is not reported, so one error does not cascade.
 */
export type RefStatus = 'resolved' | 'undefined' | 'undefinedMember' | 'uncertain' | 'silent';

export interface Reference {
  name: string;
  kinds: readonly string[];
  nameSpan: Span;
  scope: Scope;
  target?: Definition;
  status: RefStatus;
}

export type Severity = 'error' | 'warning' | 'information' | 'hint';

export interface Diagnostic {
  span: Span;
  severity: Severity;
  code: string;
  message: string;
}

export interface Analysis {
  uri: string;
  version: number;
  text: string;
  /** False when the text produced no tree at all. */
  hasTree: boolean;
  root: Scope;
  symbols: Definition[];
  references: Reference[];
  diagnostics: Diagnostic[];
  hasSkippedInput: boolean;
}

export interface TextEdit {
  uri: string;
  span: Span;
  newText: string;
}
