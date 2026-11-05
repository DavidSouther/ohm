import type {LanguageService} from '@ohm-js/language';

export interface ServeIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

export function serve(_service: LanguageService, _io: ServeIo): {dispose(): void} {
  throw new Error('not implemented');
}
