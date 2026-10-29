import test from 'ava';
import {SourcePositions} from '../src/SourcePositions.js';
import {getLineAndColumn} from '../src/util.js';

test('indexed positions preserve line, column and excerpt formatting at every offset', t => {
  for (const input of ['', 'abc', '\n', '\r\n', 'a\rb\nc\r\nd\n', '\r\r\n\n', '😀\rX\n𐀀\r\n']) {
    const positions = new SourcePositions(input);
    for (let offset = 0; offset <= input.length; offset++) {
      const expected = getLineAndColumn(input, offset);
      const actual = positions.getLineAndColumn(offset);
      t.deepEqual(positions.getLineAndColumnNumbers(offset), {
        lineNum: expected.lineNum,
        colNum: expected.colNum,
      });
      t.deepEqual(actual, expected, `${JSON.stringify(input)} at ${offset}`);
      t.is(actual.toString(), expected.toString());
      t.is(actual.toString([0, input.length]), expected.toString([0, input.length]));
    }
  }
});
