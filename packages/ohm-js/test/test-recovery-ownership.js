import test from 'ava';
import {CorrectionNode, NonterminalNode} from '../src/nodes.js';
import {emptyEffects} from '../src/RecoveryEffects.js';
import {partitionRecoveries, recoveriesOf} from '../src/RecoveryOwnership.js';

test('ownership partition visits shared diagnostic histories without expanding occurrences', t => {
  const owned = {position: 1};
  const discarded = {position: 2};
  let shared = emptyEffects.append(owned).append(discarded);
  for (let i = 0; i < 30; i++) shared = shared.concat(shared);
  let binding = new CorrectionNode(0, owned);
  const summary = recoveriesOf(binding);
  for (let i = 0; i < 100; i++) {
    binding = new NonterminalNode('Wrapped', [binding], [0], 0);
    t.is(recoveriesOf(binding), summary);
  }
  const partition = partitionRecoveries(shared, binding);
  t.deepEqual(partition.owned.toArray(), [owned]);
  t.deepEqual(partition.discarded.toArray(), [discarded]);
});
