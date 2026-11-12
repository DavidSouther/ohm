import {offset} from '@ohm-js/language';
import type {Offset, Span} from '@ohm-js/language';

/** An LSP position: zero based line and UTF-16 character. */
export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface LineIndex {
  text: string;
  /** Offset of the first character of each line. */
  starts: number[];
}

export function lineIndex(text: string): LineIndex {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return {text, starts};
}

/** Offset just past the last character of `line`, before its line break. */
function lineEnd({text, starts}: LineIndex, line: number): number {
  if (line + 1 >= starts.length) return text.length;
  const newline = starts[line + 1] - 1;
  return text[newline - 1] === '\r' ? newline - 1 : newline;
}

export function toOffset(index: LineIndex, pos: Position): Offset {
  const last = index.starts.length - 1;
  if (pos.line > last) return offset(index.text.length);
  const line = Math.max(0, pos.line);
  const start = index.starts[line];
  return offset(Math.min(start + Math.max(0, pos.character), lineEnd(index, line)));
}

export function toPosition(index: LineIndex, at: number): Position {
  const clamped = Math.max(0, Math.min(at, index.text.length));
  const {starts} = index;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= clamped) lo = mid;
    else hi = mid - 1;
  }
  return {line: lo, character: clamped - starts[lo]};
}

export function toRange(index: LineIndex, span: Span): Range {
  return {start: toPosition(index, span.start), end: toPosition(index, span.end)};
}
