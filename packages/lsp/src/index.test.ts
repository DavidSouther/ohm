import test from 'ava';

import {serve} from './index.ts';

test('serve is exported', t => {
  t.is(typeof serve, 'function');
});
