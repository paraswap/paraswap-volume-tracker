import { Interface } from '@ethersproject/abi';

export const ERC20Interface = new Interface([
  'function approve(address spender, uint256 amount) external returns (bool)',
]);

export const MerkleRedeemIface = new Interface([
  'function owner() public view returns (address)',
  'function token() public view returns (address)',
  'function seedAllocations(uint256 _week, bytes32 _merkleRoot, uint256 _totalAllocation)',
]);

export const SePSPIface = new Interface([
  'function deposit(uint256 _assetAmount) public',
  'function asset() public returns (address)',
]);

export const ERC20BalanceProbeUtilsIface = new Interface([
  'function snapshot(address token, address account) external',
  'function measure(address token, address account) public view returns (uint256 diff)',
  'function assertDiff(address token, address account, uint256 expectedDiff) external view',
]);
