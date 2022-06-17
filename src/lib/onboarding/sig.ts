import { Contract } from 'ethers';
import { hashMessage, verifyMessage } from 'ethers/lib/utils';
import { Provider } from '../provider';
import { RegisteredAddressWithSigChain } from './types';

const SIGN_ACCESS_MESSAGE = {
  message: 'I confirm that I am the owner of this account',
  version: 1, // increment version when changing message
} as const;

// based on "@argent/smartwallet-utils implementation
// https://github.com/argentlabs/argent-js/blob/master/packages/smartwallet-utils/src/wallets/argent.ts#L62-L66
// can't use @argent/smartwallet-utils directly, because it breaks without a valid Signer
const HASHED_SIGN_ACCESS_MESSAGE = hashMessage(SIGN_ACCESS_MESSAGE.message);

// reference
// ARgent: message signing https://docs.argent.xyz/wallet-connect-and-argent#message-signature
// EIP1271 https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1271.md#specification
// doesn't work with GnosisSafe because of multisig on-chain only signing
const magicEIP1271Value = '0x1626ba7e';
const EIP1271_WALLET_ABI = [
  {
    constant: true,
    inputs: [
      {
        internalType: 'bytes32',
        name: '_msgHash',
        type: 'bytes32',
      },
      {
        internalType: 'bytes',
        name: '_signature',
        type: 'bytes',
      },
    ],
    name: 'isValidSignature',
    outputs: [
      {
        internalType: 'bytes4',
        name: 'magicValue',
        type: 'bytes4',
      },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
];

type CheckEIP1271SignatureInput = RegisteredAddressWithSigChain & {
  hashedMessage: string;
};

const tryToCheckEIP1271Signature = async ({
  address,
  sig,
  hashedMessage,
  chainId,
}: CheckEIP1271SignatureInput): Promise<boolean> => {
  try {
    const provider = Provider.getJsonRpcProvider(chainId);

    const WalletContract = new Contract(address, EIP1271_WALLET_ABI, provider);

    const checkValue: string = await WalletContract.isValidSignature(
      hashedMessage,
      sig,
    );

    return checkValue.toLowerCase() === magicEIP1271Value;
  } catch (error) {
    return false;
  }
};

export const isSigValid = async ({
  sig,
  address,
  ...restProps
}: RegisteredAddressWithSigChain): Promise<boolean> => {
  const recovered = verifyMessage(SIGN_ACCESS_MESSAGE.message, sig);

  if (recovered.toLowerCase() === address.toLowerCase()) return true;

  // if signer isn't the address it still may be a SmartContract
  // try to call EIP1271Contract.isSignatureValid
  const isEIP1271SignatureValid = await tryToCheckEIP1271Signature({
    ...restProps,
    address,
    sig,
    hashedMessage: HASHED_SIGN_ACCESS_MESSAGE,
  });

  return isEIP1271SignatureValid;
};
