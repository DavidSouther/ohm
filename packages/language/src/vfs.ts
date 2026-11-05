import type {ReadonlyVfs} from './types.ts';

/** A file system whose open documents shadow a read-only base, such as the disk. */
export interface OverlayVfs extends ReadonlyVfs {
  /** Sets the text of an open document, which wins over the base. */
  set(uri: string, text: string): void;
  /** Drops an open document; the base copy, if any, shows through again. */
  delete(uri: string): void;
  has(uri: string): boolean;
  /** Whether the base has `uri`, so a closed document can fall back to it. */
  inBase(uri: string): boolean;
}

export const emptyVfs: ReadonlyVfs = {list: () => [], read: () => undefined};

export function createOverlayVfs(base: ReadonlyVfs = emptyVfs): OverlayVfs {
  const open = new Map<string, string>();
  return {
    set: (uri, text) => void open.set(uri, text),
    delete: uri => void open.delete(uri),
    has: uri => open.has(uri),
    inBase: uri => base.read(uri) !== undefined,
    read: uri => open.get(uri) ?? base.read(uri),
    list: () => [...new Set([...base.list(), ...open.keys()])],
  };
}
