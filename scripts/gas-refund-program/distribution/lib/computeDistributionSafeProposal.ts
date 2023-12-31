import '../../setup';
import { MerkleTreeAndChain } from './types';
import { SafeProposalConfig, generateSafeProposal } from '../utils/safeHelper';
import { MerkleRedeemAddressSePSP1 } from '../../../../src/lib/gas-refund/gas-refund-api';
import { Contract } from 'ethers';
import { Provider } from '../../../../src/lib/provider';
import { ERC20Interface, MerkleRedeemIface, SePSPIface } from './abis';

export async function computeDistributionSafeProposal(
  merkleDistributionData: MerkleTreeAndChain,
): Promise<SafeProposalConfig> {
  const {
    chainId,
    merkleTree: {
      root: { totalAmount: totalAmountRefunded, merkleRoot, epoch },
    },
  } = merkleDistributionData;

  const merkleRedeemAddress = MerkleRedeemAddressSePSP1[+chainId];

  const MerkleRedeem = new Contract(
    merkleRedeemAddress,
    MerkleRedeemIface,
    Provider.getJsonRpcProvider(+chainId),
  );

  const [sePSP1Address, govCoMsAddress] = await Promise.all([
    MerkleRedeem.token(),
    MerkleRedeem.owner(),
  ]);

  const sePSP1 = new Contract(
    sePSP1Address,
    SePSPIface,
    Provider.getJsonRpcProvider(+chainId),
  );

  const PSPAddress = await sePSP1.asset();

  const txs = [
    {
      to: PSPAddress,
      data: ERC20Interface.encodeFunctionData('approve', [
        sePSP1Address,
        totalAmountRefunded,
      ]),
      value: '0',
    },
    {
      to: sePSP1Address,
      data: SePSPIface.encodeFunctionData('deposit', [totalAmountRefunded]),
      value: '0',
    },
    {
      to: sePSP1Address,
      data: SePSPIface.encodeFunctionData('approve', [
        merkleRedeemAddress,
        totalAmountRefunded,
      ]),
      value: '0',
    },
    {
      to: merkleRedeemAddress,
      data: MerkleRedeemIface.encodeFunctionData('seedAllocations', [
        epoch,
        merkleRoot,
        totalAmountRefunded,
      ]),
      value: '0',
    },
  ];

  const safeProposal = generateSafeProposal(govCoMsAddress, +chainId, txs);

  return safeProposal;
}
