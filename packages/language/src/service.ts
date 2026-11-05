import type {Semantics} from 'ohm-js';

import type {Analysis, Offset, ServiceConfig, Span, Symbol, TextEdit} from './types.ts';

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

export function createLanguageService(
  _semantics: Semantics,
  _config: ServiceConfig
): LanguageService {
  throw new Error('not implemented');
}
