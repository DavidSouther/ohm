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

export interface ImportOpts {
  /** Name nodes bound by the import; each must be exported by the target module. */
  names?: readonly RoleNode[];
}

export type Role =
  | Readonly<{role: 'scope'}>
  | Readonly<{role: 'import'; spec: RoleNode; opts: ImportOpts}>
  | Readonly<{role: 'declare'; name: RoleNode; kind: string; opts: DeclareOpts}>
  | Readonly<{role: 'ref'; name: RoleNode; kinds: readonly string[]; opts: RefOpts}>;

/** A symbol defined outside any document, such as a builtin chip or an OS class. */
export interface ExternalSymbol {
  members?: readonly string[];
}

/**
 * A read-only file system: the disk, or any other source of files, by URI.
 * Both calls are asynchronous, and `list` streams its URIs as they are found,
 * so a large tree or a slow store never blocks the editor.
 */
export interface ReadonlyVfs {
  list(): AsyncIterable<string>;
  /** The text of `uri`, or undefined when there is no such file. */
  read(uri: string): Promise<string | undefined>;
}

/**
 * How files relate to each other. `ambient` languages (every class or chip in
 * a project is visible) look names up across all files; `explicit` languages
 * see only what an `import` role names. Which definitions a file exports is the
 * language's decision, so `exported` has no default.
 */
export interface WorkspaceConfig {
  mode: 'ambient' | 'explicit';
  exported(definition: Definition): boolean;
  /** Files that are not open, read as a fallback behind open documents. */
  vfs?: ReadonlyVfs;
  /** Maps an import specifier, as written, to a document URI. Required in explicit mode. */
  resolveImport?(specifier: string, fromUri: string): string | undefined;
}

export interface ServiceConfig {
  start: string;
  workspace?: WorkspaceConfig;
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
  /** For an import binding, the exported definition it stands for. */
  aliasOf?: Definition;
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
  /** URIs of the modules this document imports and could resolve. */
  imports: string[];
}

export interface Location {
  uri: string;
  span: Span;
}

export interface TextEdit {
  uri: string;
  span: Span;
  newText: string;
}
