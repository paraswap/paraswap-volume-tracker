import BigNumber from 'bignumber.js';
import { assert } from 'console';
import { BigNumber as EthersBN, Contract } from 'ethers';
import { CHAIN_ID_MAINNET, PSP_ADDRESS } from '../../../src/lib/constants';
import { Provider } from '../../../src/lib/provider';
import { ZERO_BN } from '../utils';
import { getTokenBalance } from './covalent';

const SafetyModuleAdress = '0xc8dc2ec5f5e02be8b37a8444a1931f02374a17ab';
const SafetyModuleVotingPower = '0x3972d949f6f755a198633e7a151021bd1250d5ae';

const SafetyModuleVotingPowerAbi = [
  'function getVotePower(address voter, address safetyModule, address votingToken) external view returns (uint256)',
];

interface SafetyModuleContractClass extends Contract {
  getVotePower(
    voter: string,
    safetyModule: string,
    votingToken: string,
  ): EthersBN;
}

const SafetyModuleContract = new Contract(
  SafetyModuleVotingPower,
  SafetyModuleVotingPowerAbi,
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
) as SafetyModuleContractClass;

export const fetchSafetyModuleStakes = async ({
  account,
  blockNumber,
}: {
  account: string;
  blockNumber: number;
}) => {
  const chainId = CHAIN_ID_MAINNET; // safety module only available on ethereum

  // fetch via covalent to rely on fast/cheap chain infrastructure
  const tokenBalance = await getTokenBalance({
    token: SafetyModuleAdress,
    address: account,
    blockHeight: String(blockNumber),
    chainId,
  });

  if (tokenBalance.isZero()) return ZERO_BN;

  const votePower = await SafetyModuleContract.getVotePower(
    account,
    SafetyModuleAdress,
    PSP_ADDRESS[chainId],
  );

  assert(
    votePower.isZero(),
    'Safety module stakes should not be zero at this point',
  );

  return new BigNumber(votePower.toString());
};
