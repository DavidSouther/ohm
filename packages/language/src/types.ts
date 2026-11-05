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
  hoist?: boolean;
  after?: boolean;
  type?: RoleNode;
  private?: boolean;
  detail?: string;
  doc?: string;
  data?: unknown;
}

export interface RefOpts {
  via?: RoleNode | Role;
  orDeclare?: string;
  after?: boolean;
  external?: boolean;
  private?: boolean;
}

export type Role =
  | Readonly<{role: 'scope'}>
  | Readonly<{role: 'declare'; name: RoleNode; kind: string; opts: DeclareOpts}>
  | Readonly<{role: 'ref'; name: RoleNode; kinds: readonly string[]; opts: RefOpts}>;

export interface ServiceConfig {
  start: string;
  namespaces?: Record<string, string[]>;
}

export interface Scope {
  parent?: Scope;
  symbols: Symbol[];
  span: Span;
}

export interface Symbol {
  name: string;
  kind: string;
  nameSpan: Span;
  uri: string;
  scope: Scope;
  implicit: boolean;
  private: boolean;
  /** The symbol is visible to references that start at or after this offset. */
  visibleFrom: Offset;
}

export type RefStatus = 'resolved' | 'undefined' | 'uncertain';

export interface Reference {
  name: string;
  kinds: readonly string[];
  nameSpan: Span;
  scope: Scope;
  target?: Symbol;
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
  symbols: Symbol[];
  references: Reference[];
  diagnostics: Diagnostic[];
  hasSkippedInput: boolean;
}

export interface TextEdit {
  uri: string;
  span: Span;
  newText: string;
}
