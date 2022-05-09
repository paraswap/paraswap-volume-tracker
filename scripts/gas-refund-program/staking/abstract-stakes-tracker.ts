export default class AbstractStakeTracker {
  startBlock: number;
  endBlock: number;

  setBlockBoundary(startBlock: number, endBlock: number) {
    this.startBlock = startBlock;
    this.endBlock = endBlock;

    return this;
  }
}
