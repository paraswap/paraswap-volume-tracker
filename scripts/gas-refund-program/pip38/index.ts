import { assert } from 'ts-essentials';
import fantomEpoch36 from './merkletree-chain-250-epoch-36.json';
import fantomEpoch37 from './merkletree-chain-250-epoch-37.json';
import { AddressRewards } from '../types';
import { groupBy } from 'lodash';
import BigNumber from 'bignumber.js';
import { CHAIN_ID_FANTOM, CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { GasRefundV2PIP38 } from '../../../src/lib/gas-refund/gas-refund';

export function composeRefundWithPIP38Refunds(
  epoch: number,
  userRewards: AddressRewards[],
): AddressRewards[] {
  if (epoch !== GasRefundV2PIP38) return userRewards;

  const epochRefundsByAddress = groupBy(userRewards, 'account');
  const epoch38FantomRefundByAddress = groupBy(
    fantomEpoch36.merkleProofs,
    'address',
  );
  const epoch37FantomRefundByAddress = groupBy(
    fantomEpoch37.merkleProofs,
    'address',
  );

  const allAccounts = Array.from(
    new Set(
      userRewards
        .map(v => v.account.toLowerCase())
        .concat(fantomEpoch36.merkleProofs.map(v => v.address.toLowerCase()))
        .concat(fantomEpoch37.merkleProofs.map(v => v.address.toLowerCase())),
    ),
  );

  return allAccounts.reduce<AddressRewards[]>((acc, account) => {
    const epochRefundsMultipleChains = epochRefundsByAddress[account];

     assert(
        (epoch37FantomRefundByAddress[account]?.length ?? 0) <= 1,
        'each account should have at most one record for epoch 37 fantom',
      );
      assert(
        (epoch38FantomRefundByAddress[account]?.length ?? 0) <= 1,
        'each account should have at most one record for epoch 38 fantom',
      );

    const epoch37FantomRefund = epoch37FantomRefundByAddress[account]?.[0];
    const epoch38FantomRefund = epoch38FantomRefundByAddress[account]?.[0];

    assert(
      epochRefundsMultipleChains || epoch37FantomRefund || epoch38FantomRefund,
      'at least one entry here',
    );

    const r37 = new BigNumber(epoch37FantomRefund.amount || '0');
    const r38 = new BigNumber(epoch38FantomRefund.amount || '0');
    const amountPip38 = r37.plus(r38);

    if (epochRefundsMultipleChains) {
      epochRefundsMultipleChains.forEach(epochRefundForChain => {
        if ((epochRefundForChain.chainId = CHAIN_ID_MAINNET)) {
          const _breakDownGRPFantom =
            epochRefundForChain.breakDownGRP[CHAIN_ID_FANTOM] ||
            new BigNumber(0);

          assert(
            epochRefundForChain.chainId === CHAIN_ID_MAINNET &&
              epoch == GasRefundV2PIP38,
            'we should have anything different than ethereum and epoch=38 here',
          ); // sanity check

          acc.push({
            ...epochRefundForChain,
            amount: epochRefundForChain.amount.plus(amountPip38),

            breakDownGRP: {
              ...epochRefundForChain.breakDownGRP,
              [CHAIN_ID_FANTOM]: _breakDownGRPFantom.plus(amountPip38),
            },
          });
        } else {
          acc.push(epochRefundForChain);
        }
      });
    } else {
      acc.push({
        account,
        amount: amountPip38,
        chainId: CHAIN_ID_MAINNET, // refund only on ethereum
        breakDownGRP: { [CHAIN_ID_FANTOM]: amountPip38 },
      });
    }

    return acc;
  }, []);
}
