import { Interface } from 'ethers/lib/utils';
import '../../../setup';
import { MerkleTreeAndChain } from './types';
import {
  SafeProposalConfig,
  generateSafeProposal,
} from '../utils/utils/safeHelper';
import { MerkleRedeemAddressSePSP1 } from '../../../../src/lib/gas-refund/gas-refund-api';
import { Contract } from 'ethers';
import { Provider } from '../../../../src/lib/provider';

export const ERC20Interface = new Interface([
  'function approve(address spender, uint256 amount) external returns (bool)',
]);

const MerkleRedeemIface = new Interface([
  'function owner() public view returns (address)',
  'function token() public view returns (address)',
  'function seedAllocations(uint256 _week, bytes32 _merkleRoot, uint256 _totalAllocation)',
]);

const SePSPIface = new Interface([
  'function deposit(uint256 _assetAmount) public',
  'function asset() public returns (address)',
]);

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
