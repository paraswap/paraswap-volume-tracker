import BigNumber from 'bignumber.js';
import { fetchRawReceipt } from '../../src/lib/fetch-tx-gas-used';
import { getRefundPercent } from '../../src/lib/gas-refund/gas-refund';
import { ExtendedCovalentGasRefundTransaction } from '../../src/types-from-scripts';
import { GasRefundTransactionDataWithStakeScore } from '../gas-refund-program/transactions-indexing/types';
import { PatchInput } from './types';
import { CHAIN_ID_OPTIMISM } from '../../src/lib/constants';
import { Provider } from '../../src/lib/provider';
/**
 * the purpose of this patch is to add the txs that at the time fo writting are not returned by data-source used by this script, although were included in the GRP 46 epoch program
 * those are v6.0 txs (successful and reverted)
 */
type PatchedTxTuple = [chainId: number, txHash: string];
const patchTxsToInclude =
  `> 1,"0x87a659702597b6f7f05690543695e6bcefa170fb3656f35f98a9db4593e9cf23"
> 1,"0x7ed56c0213248beafdab915a13e130a2792f30e90822596e465c6393974c4335"
> 1,"0x73a77b3f9b3a75ebb45382ca8b69e37ffd8a45aa987c783d7b211e0e2373e456"
> 1,"0x6f3115ef1c757fa047c30a3b6c5948b6dceb90a79660d8f712fbaa9e0f790af4"
> 1,"0x6009e67f33b428eae2ff1cea8b9faa8015332879ef951571222222807f106bbc"
> 1,"0x4926ea192b678a4fc35e9d6abe2c9450c747a5c087024b88a0de37e8464067c7"
> 1,"0x46e6534fd3b09372601e0d7a0df9a3f31b92a8b889eea75725f4c8ca9a98e5e7"
> 1,"0x43dc80bd955db6aeb9be519a92b7af265f2ef0dd96aa827c81779dfa2571ac66"
> 1,"0x3dd4a57d49c1692737500f4232dbf321fd6c758fef50217505cebf7267715d1c"
> 1,"0x2516b2cd73b94322f7cb078fe5cb550de6a074bb07285289a6a01fbe8fbf0b03"
> 1,"0x1bd7ce653472cdf449ccaaf4ebd2a6f673f0e96d45d6a766255441046cc2b19a"
> 10,"0x324d6c13870922ec4e018dcae3c9e7e1f060beff62b8f4baf87c550c5dabc2bc"
> 10,"0x131e24ab2fbf491c71e1a35f2010c6cb470811c93493cc5b1e9d28f5116a62be"
> 10,"0x2555e265df7b2d3ec4b1d5ed04795a72e064d64d510a4a3f0c0983cb712bc15b"
> 10,"0x70a839ba36d8c427cb2a83274155b4dbde63d4325e393348e5048387d5d81b84"
> 10,"0x92fc86d4e9f4bacabe7f2401cc859ce09a54cfa40462582af27c9abecff8c0b4"
> 10,"0xd3701c9e11b8642e9e93a3e73cbb172e4db60f9bb02b12a325c62ea49ba78855"
> 10,"0x4c7661e5b0b2bb2fad8e5c47ebdec4075f632ae670c7371375480b435dcce197"
> 56,"0x1b11357cc68ab80b1ca78b4bfd758573ab7cf83e40aaf7ad8a82669612f749bb"
> 56,"0xffead40e678e5e846142d1825ba67bb4497770da49b0b6c4546e3e4351deed6b"
> 56,"0xf7f98ca090457307fb4997c9397b587cf10c3e10358b916d2518ac280060df23"
> 56,"0xf724c7c858bf6dad982cbbd039141234b5fcc5a8056874b2170ad16de1ff8f02"
> 56,"0xf66725fb5aea8cd749972d940f668bea7e9d596889d84b6e2a77ae22024a79fd"
> 56,"0xf2ba3e2be5539f1fb59be899a3850245cab6b42dd0f019ed3cd6b6f5d1c1247c"
> 56,"0xea0a28d2b69ace3f8b1ff81b7ad4ab9355f224454a5492d751f9c1e35f7187e1"
> 56,"0xe8553c9a4840b8523bea865b6553388cb18095af14835a8ea13597efb5011f16"
> 56,"0xe6ee19d85a8659c4f0d68d84054a66203385a5f604c800b8fb768f4c65c0212e"
> 56,"0xe614fb8f57fe81156ce1eb80042e917d761e3b0cc88d138d36c7a638c5697faf"
> 56,"0xe4b218a3ae03ba476f52100d6654ff399cf3dc012448e5f5ee65c77d0646023e"
> 56,"0xc59dddb4d7949c0ca8e97fd80387e5a643946391cfe47a9e4b12067463b4d841"
> 56,"0xc0cf0e4586979fd0a6a700c9f1b61de9ad07cd413d5830c2e3d7744cbe83ab86"
> 56,"0xbfec331be18207a5541e64d0d1fd3b49fe77475517f442602191144117115e9a"
> 56,"0xbf496a96ee5457324f51e8b25c0371056cf218e6a10b2adf7e8b861d4eee3fe7"
> 56,"0xb117e9ee33c36bb3fafbbb1e23efdacbb95ce8e3c047f632d10d26d987cf725a"
> 56,"0xaeed1fdba197ae4056c817880ad811f73a990e660eb6ad74060746599c313bbe"
> 56,"0xaa0f690f672d5eb1adc72260bed705ba59b0918f1bdc241d7b6a1b0072d3d635"
> 56,"0x8ed63c4fdc076ca944f786ddcb8c6622e4f22ffee44ae41af8f0922af4f0e39f"
> 56,"0x8dae51e771a42f774051fbeac70f8daeff620eea57582a2f7a9cec4fe41a2345"
> 56,"0x8764aaf8f5b7045159428f190e786be509510527e1461a431b638166972df2a3"
> 56,"0x850d3f50d7c5a25475cc62ef8a5d61f685a5d81a2230ef107f815067c160e86f"
> 56,"0x6cd4046947c1b553171a1646c68c4029654105c56d04b1c588476d1fb0efc430"
> 56,"0x68b87d635b65c3b73deee4fc4fb3fd829297e1de1b3c6dea2e50a7424023ac23"
> 56,"0x63ba0b93396f23f4750d6d63b91fb797df698958d51c1c946352c4e7bb39d308"
> 56,"0x5c855cf67b16c50694f06fa829376eeeddb15ff3da4913caf6c73124dd6ae2e6"
> 56,"0x5539335ad6b9458674e655b2435e82fcf926f6726e6e97c8d572526e680fff97"
> 56,"0x547dab2d946ff640d6ea254c75c5e6a7c2f3d244a73f2be22474b8a89990aa38"
> 56,"0x52896bea67179b904955f1f8979f5670ecc3cb8eb5d54680cf68a3a05ba0e62c"
> 56,"0x4b7266eb57ca6b3e300551d4213f6018bb06e4bc81362921eaa02206b5d779ca"
> 56,"0x412332d23dd244a9270123e86e6e112acbd68e3f93c523a1edb7ae3dd08c8e9f"
> 56,"0x38330405bcb47c319d8f169f9f96f0f90d71aa19c2d955939349f308e5f6927d"
> 56,"0x30bfc527a5394ec681d6fc0290fae09d5dfa20442ee9f5f1edc85fa61372c096"
> 56,"0x2f402be52ac3b0087d66c133b22184fe8fb35e69aaaeeb6247fa9ca5cb379570"
> 56,"0x270dcedb780bfe224e2b11b2a89520b7f3d52a1f95cc972640a98d8c51349a17"
> 56,"0x2525e17ed357bba810ff95eca3a26f6466ae4522b4d1a49c925eca4c6c18676b"
> 56,"0x245e25fcdbc3b7611d5747814f6d9804b508af0647607326ed11166a1d52e1b8"
> 56,"0x20ca17c2dfdeaff420458c2520fe5836db85a36ebfc46263e4619dac08bc8839"
> 56,"0x1ffe7711bde6280c79a64ba9d1a212e0794f9165866952003e51677e446f04a5"
> 56,"0x1649e8aaf855e573a158781156079948336b5f5dc00f6254dff8524d53b2cd6f"
> 56,"0x0d7c0d73c9a3c85d2d3ed61691b6891e0d0487dffbaee28472cc80cc0988efc8"
> 137,"0x9d10c0ba1ea5573b50fba40a9a26e36e3915fe904aa881456346c9e629f3ddfd"
> 137,"0x8bbd5286167b9db7f57721e0f7238c7e77319e6a9ecade2cbe42a97bdccf2211"
> 137,"0x84186271dacdc1004611dee44348c98292a4881a7e65b132782eba34ffcdd5a9"
> 137,"0x663ef498b7aceb04c9046f12ff001ddc64336614dad59030692ef298e9d19b74"
> 137,"0x59d5a1ca6e6bc455ac1fb03ddc665c48b3b868575be65873895e0584a38fdd6e"
> 137,"0x45b8f2fa329a215197f55eca225fe46320ec98d29557f0790f3fd603b4417ab1"
> 137,"0x4065d45761708e64466beb88d39ea70c22d9b20d5f75f148defea2f73d59d700"
> 137,"0x3bc2940b0c92410aea4219ba706763f312f82f0d1f2dd0d5f1402e78d8895574"
> 137,"0xb211b1e78f0ae063d84d3adf089555d0374bf0f6c0098e869b40f391e3f3eb2d"
> 137,"0xc54df66056b46f04da8acadba5fc401e6718c249c29e212f4f85e9af912df7e7"
> 137,"0xd22c9f6210fb3484705f3a60d07e1fbb56f1606c568db388bd6636968b9056eb"
> 137,"0xec6fecb2ff1885292745aa16d22e508ab9bebf1f582516b644b2c9c5549173fb"
> 137,"0xff3f13727b3d9783fa2864d2f2e8a209f7c38d2054779438522455b4652ea25c"
> 137,"0xfa29ff9d56f6d1c3493048ac6629555fe5e6e9eba7634d925398399c4f1ec532"
> 137,"0xf7577f18b52d2d80ac6e5e6f931f859cfc2c4dfae56dc13446234e4770681908"
> 137,"0xeecde1b7f2fdd455dfda3653fcfb848cdc7431da74497d4ea17f33f38cceba71"
> 137,"0xde6af478a35da9b8998bfd4ba09f81f50fc2fb18394199071692ae9affac8035"
> 137,"0xd1608173c30edea31bd061e502d7e97aa4579a00c16f52b806450ca155a88f08"
> 137,"0xc84b4025854a2df8258b246853db7a8b6e44bc53a2e1e89250347a1ae5fcfab0"
> 137,"0xc3db08db23ed85cdbb23b1d88c071d876b07a2329de90d0761f2bdc5af2622c5"
> 137,"0xbd5d655054f7d5239dd35a6256edaeaf39a3a7c0371ee37eca216afe1ae54828"
> 137,"0xb2c4a3cf7c51e99c8cbd172f13d142b3feabc6b8d68dc15b57ba9e4e7a5761ee"
> 137,"0xab8a9c247fa989b178fe5f6d3eb03d98eee843ba5442541c88da38c96f444581"
> 137,"0x90735d1f316e1b7b756d51ff5fe6a47a64f040baf1a30ad5a1cf46d8ffa3aec6"
> 137,"0x8f32f7c65be4ce08f5d1df7388b2be97e4435d63b9cbc018c54b1741842e4943"
> 137,"0x7eacb0a9d23302ceac919ef3f19a330bf00d8839bb17735d9b97f738ceeb5a25"
> 137,"0x7a4c7d02d71234bc67c89a6401b2e9d0de000ba3482a1cbe9cb34b2ae8536475"
> 137,"0x6f9851b87aba752445dfb4fbb9d730e23a9cbde36ae666a46bd884ee0a79117f"
> 137,"0x6ae92d2245e7d481cd1ea586f234a20776d175bb316a5608d8763f85874f82d8"
> 137,"0x5464715432f45b6fb3c363bd21a55c75a4f378bf288223c083b1a65d6767a066"
> 137,"0x487198dafbd2e2d9e9dbd82046c7324d85fceaa4b362c23b22d01885261497de"
> 137,"0x44db1e1d2b96a0193388f5a84fd07b0548c7479ced644d7f4fdb2d0a56794b2c"
> 137,"0x334aaae6d3b073dae100ddacd78639c3cb44e4ada5e29b38a62279c3af9537db"
> 137,"0x28df1ba886370f81957630c8cb2fad68dd7706f12cf0f1bb2af1a19013d3cd0e"
> 137,"0x219a8d2dbcb2e28451924e08aa6550006fe32b6deb464780a22f9ccd35399277"
> 137,"0x0a8acd39e28d83e45f48aa18ce95817d9b2409901039094b14c6a1e3c67c75da"
> 250,"0xcc2028a39e85ada43b93ded0607abe40f7303c96ceace70811731aab238ae774"
> 250,"0x982d30e9a2091c2e10aeef5c498dbe3e4cbdd12eb0f4bb14a9074ee17da57496"
> 250,"0x6cd1069dd923b43630c328d24fec4aace60d646aac2b38008801cf7a25f48ed4"
> 250,"0x59d6a6521a7681b2e63da1917a7ceaebf444ec19676b9d086b62211bb7dc41ba"
 `
    .trim()
    .split('\n')
    .map<PatchedTxTuple>(l => {
      const [chainId, tx] = l.replace(/^> /, '').replace(/"/g, '').split(',');
      return [parseInt(chainId, 10), tx.toLowerCase()];
    });

// console.log(txsToInclude);

async function extendPatchTx(
  tuples: PatchedTxTuple[],
): Promise<ExtendedCovalentGasRefundTransaction[]> {
  const rawReceipts = await Promise.all(
    tuples.map(async ([chainId, txHash]) => {
      return [
        chainId,
        await fetchRawReceipt({
          txHash,
          chainId,
        }),
      ];
    }),
  );

  return Promise.all(
    rawReceipts.map(async ([chainId, rawReceipt]) => {
      const gasSpentInChainCurrencyWei = new BigNumber(rawReceipt.gasUsed)
        .multipliedBy(rawReceipt.effectiveGasPrice)
        .plus(chainId === CHAIN_ID_OPTIMISM ? rawReceipt.l1Fee : 0)
        .toFixed();

      const block = await Provider.getJsonRpcProvider(chainId).getBlock(
        rawReceipt.blockNumber,
      );

      const result: ExtendedCovalentGasRefundTransaction = {
        txOrigin: rawReceipt.from.toLowerCase(),
        txGasPrice: new BigNumber(rawReceipt.effectiveGasPrice).toFixed(),
        blockNumber: new BigNumber(rawReceipt.blockNumber).toFixed(),
        timestamp: block.timestamp.toString(),
        txGasUsed: new BigNumber(rawReceipt.gasUsed).toFixed(),
        gasSpentInChainCurrencyWei,
        contract: rawReceipt.to.toLowerCase(),
        txHash: rawReceipt.transactionHash.toLowerCase(),
      };
      return result;
    }),
  );
}

export async function applyEpoch46Patch(
  patchInput: PatchInput,
): Promise<GasRefundTransactionDataWithStakeScore[]> {
  const { processRawTxs, txs } = patchInput;

  const composedRawTxs: ExtendedCovalentGasRefundTransaction[] =
    await extendPatchTx(
      patchTxsToInclude.filter(item => item[0] === patchInput.chainId),
    );

  // need to ensure these patch txs are included.
  // could also check if they're already added and skip if so, but it's not necessary at the time of writting
  return txs.concat(
    await processRawTxs(
      composedRawTxs,
      (epoch, totalUserScore) => getRefundPercent(epoch, totalUserScore), // assuming all the txs dealt with are obeying gas normal refund logic (i.e. not MIGRATION tx that is refunfed in full)
    ),
  );
}
