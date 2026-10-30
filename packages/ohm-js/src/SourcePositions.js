import {getLineAndColumn, lineAndColumnToMessage} from './util.js';

function lowerBound(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class SourcePositions {
  constructor(input) {
    this.input = input;
    this._lineStarts = [0];
    this._carriageReturns = [];
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code === 10) this._lineStarts.push(i + 1);
      else if (code === 13) this._carriageReturns.push(i);
    }
    Object.freeze(this._lineStarts);
    Object.freeze(this._carriageReturns);
    Object.freeze(this);
  }

  getLineAndColumnNumbers(offset) {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.input.length) {
      const {lineNum, colNum} = getLineAndColumn(this.input, offset);
      return {lineNum, colNum};
    }
    const starts = this._lineStarts;
    const line = lowerBound(starts, offset + 1) - 1;
    const lineStart = starts[line];
    // A carriage return never advances Ohm's column, including a lone CR.
    const carriageReturns =
      lowerBound(this._carriageReturns, offset) -
      lowerBound(this._carriageReturns, lineStart);
    return {lineNum: line + 1, colNum: offset - lineStart + 1 - carriageReturns};
  }

  getLineAndColumn(offset) {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.input.length) {
      return getLineAndColumn(this.input, offset);
    }
    const {lineNum, colNum} = this.getLineAndColumnNumbers(offset);
    const starts = this._lineStarts;
    const line = lineNum - 1;
    const lineStart = starts[line];
    const lineEnd = line + 1 < starts.length ? starts[line + 1] - 1 : this.input.length;
    const nextEnd = line + 2 < starts.length ? starts[line + 2] - 1 : this.input.length;
    return {
      offset,
      lineNum,
      colNum,
      line: this.input.slice(lineStart, lineEnd).replace(/\r$/, ''),
      prevLine:
        line > 0 ? this.input.slice(starts[line - 1], lineStart).replace(/\r?\n$/, '') : null,
      nextLine:
        line + 1 < starts.length
          ? this.input.slice(starts[line + 1], nextEnd).replace(/\r$/, '')
          : null,
      toString: lineAndColumnToMessage,
    };
  }
}
