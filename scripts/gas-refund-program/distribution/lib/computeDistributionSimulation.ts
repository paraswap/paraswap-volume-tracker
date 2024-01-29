import '../../setup';
import { assert } from 'ts-essentials';
import { BigNumberish, constants } from 'ethers';
import { isTruthy } from '../../../../src/lib/utils';

import { SafeProposalConfig } from '../utils/safeHelper';
import { simulateTxs } from '../utils/simulationHelper';
import { ERC20BalanceProbeUtilsIface, MerkleRedeemIface } from './abis';
import { MerkleTreeAndChain } from './types';
import { MerkleRedeemAddressSePSP1 } from '../../../../src/lib/gas-refund/gas-refund-api';
import { config } from './config';

const genSnapshotBalanceTx = (
  chainId: number,
  token: string,
  account: string,
) => {
  const { erc20BalanceProbeChecker } = config[chainId];
  assert(erc20BalanceProbeChecker);

  return {
    from: constants.AddressZero,
    to: erc20BalanceProbeChecker,
    data: ERC20BalanceProbeUtilsIface.encodeFunctionData('snapshot', [
      token,
      account,
    ]),
  };
};

const genAssertBalanceTx = (
  chainId: number,
  token: string,
  account: string,
  expectedDiff: BigNumberish,
) => {
  const { erc20BalanceProbeChecker } = config[chainId];
  assert(erc20BalanceProbeChecker);

  return {
    from: constants.AddressZero,
    to: erc20BalanceProbeChecker,
    data: ERC20BalanceProbeUtilsIface.encodeFunctionData('assertDiff', [
      token,
      account,
      expectedDiff,
    ]),
  };
};

/// SIMULATE DISTRIBUTION AND BALANCE CHECKS OF CONTRACT
function genDistributionSimulations(
  merkleDistributionData: MerkleTreeAndChain,
  actualDistributionSafeProposal: SafeProposalConfig,
  withBalanceCheck: boolean,
) {
  const {
    chainId,
    merkleTree: {
      root: { totalAmount },
    },
  } = merkleDistributionData;
  const grpDistributor = MerkleRedeemAddressSePSP1[+chainId];

  const { govCoMs, sePSP1 } = config[+chainId];

  const { transactions: transactionsWithoutFrom } =
    actualDistributionSafeProposal;
  const distributionTxs = transactionsWithoutFrom.map(v => ({
    ...v,
    from: govCoMs,
  }));

  return [
    withBalanceCheck && genSnapshotBalanceTx(+chainId, sePSP1, grpDistributor),
    ...distributionTxs,
    withBalanceCheck &&
      genAssertBalanceTx(+chainId, sePSP1, grpDistributor, totalAmount),
  ].filter(isTruthy);
}

const bigIntComparator = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/// SIMULATE CLAIM AND BALANCE CHECKS OF SOME PARTICIPANTS
const CLAIMS_LENGHT = 2; // will be 2x

async function genClaimDistributionTxs(
  merkleDistributionData: MerkleTreeAndChain,
  withBalanceCheck: boolean,
) {
  const {
    chainId,
    merkleTree: {
      merkleProofs: proofs,
      root: { epoch },
    },
  } = merkleDistributionData;

  const contract = MerkleRedeemAddressSePSP1[+chainId];

  const { sePSP1 } = config[+chainId];

  const sortedClaims = [...proofs].sort((a, b) =>
    bigIntComparator(BigInt(a.amount), BigInt(b.amount)),
  );

  // top 2 and bottom 2
  const someClaims = sortedClaims
    .slice(0, CLAIMS_LENGHT)
    .concat(sortedClaims.slice(-CLAIMS_LENGHT));

  const txs = someClaims.flatMap(
    ({ address: account, amount: claimableAmount, proof }, index) =>
      [
        withBalanceCheck && genSnapshotBalanceTx(+chainId, sePSP1, account),
        {
          from: account,
          to: contract,
          data: MerkleRedeemIface.encodeFunctionData('claimWeek', [
            account,
            epoch,
            claimableAmount,
            proof,
          ]),
        },
        withBalanceCheck &&
          genAssertBalanceTx(
            +chainId,
            sePSP1,
            account,
            BigInt(claimableAmount),
          ),
      ].filter(isTruthy),
  );

  return txs;
}

const usePublicFork = true;

export async function computeDistributionSimulation(
  merkleDistributionData: MerkleTreeAndChain,
  actualDistributionSafeProposal: SafeProposalConfig,
  withBalanceCheck: boolean,
): Promise<string> {
  const { chainId } = merkleDistributionData;

  const simulationsTxs = [
    ...genDistributionSimulations(
      merkleDistributionData,
      actualDistributionSafeProposal,
      withBalanceCheck,
    ),
    ...(await genClaimDistributionTxs(
      merkleDistributionData,
      withBalanceCheck,
    )),
  ];

  const { simulationUrls, publicForkUrl } = await simulateTxs(
    +chainId,
    simulationsTxs,
    false,
  );

  if (usePublicFork) return publicForkUrl;
  return simulationUrls.join('\n');
}
