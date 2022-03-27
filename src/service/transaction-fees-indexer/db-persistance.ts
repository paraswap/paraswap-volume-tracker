import { EpochGasRefund } from "../../models/EpochGasRefund"
import { MerkleData, MerkleTreeDataByChain, PSPStakesByAddress, UpdateCompletedEpochData } from "./types"

export const writeCompletedEpochData = async (merkleTreeDataByChain: MerkleTreeDataByChain, pspStakesByAddress: PSPStakesByAddress) => {

  /*
  epoch: number                   merkleTreeDataByChain.[chainId].root.epoch
  address: string                 merkleTreeDataByChain.[chainId].leaves[].address
  chainId: string                 merkleTreeDataByChain.[chainId].leaves[].amount

  totalStakeAmountPSP: string     pspStakesByAddress[address]
  refundedAmountPSP: string       merkleTreeDataByChain.[chainId].root.totalAmount
  merkleProofs: string[]          merkleTreeDataByChain.[chainId].leaves[].merkleProofs
  merkleRoot: string              merkleTreeDataByChain.[chainId].root.merkleRoot
  */

  const epochDataToUpdate: UpdateCompletedEpochData[] = Object
  .keys(merkleTreeDataByChain)
  .map((chainId) => {
    const merkleTreeDataForChain = merkleTreeDataByChain[+chainId]
    // because `computeMerkleData` can return null
    if (!merkleTreeDataForChain) {
      return []
    }
    const { root: { epoch, totalAmount, merkleRoot }, leaves } = merkleTreeDataForChain

    const addresses = leaves.map((leaf: MerkleData) => ({
      epoch,
      address: leaf.address,
      chainId,

      totalStakeAmountPSP: pspStakesByAddress[leaf.address].toString(), // todo: make safe
      refundedAmountPSP: totalAmount,
      merkleProofs: leaf.merkleProofs,
      merkleRoot,
    }))
    return addresses
  })
  // lastly flatten the array (of chain specific arrays)
  .reduce((buildingArray, array) => buildingArray.concat(array), [])


  // todo: bulk upsert epoch data once models are defined
  for (let i = 0; i < epochDataToUpdate.length; i++) {
    const endEpochData = epochDataToUpdate[i];

    // key
    const { epoch, address, chainId } = endEpochData
    // update
    const { totalStakeAmountPSP, refundedAmountPSP, merkleProofs, merkleRoot } = endEpochData

    const row = await EpochGasRefund.findOne({ where: { epoch, address, chainId }})

    await EpochGasRefund.update(
      {
        totalStakeAmountPSP, refundedAmountPSP, merkleProofs, merkleRoot
      },
      {
        where: { epoch, address, chainId}
      }
    )
  }

}