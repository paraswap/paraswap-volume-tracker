import { DataType } from 'sequelize-typescript';

export const DataType_ADDRESS = DataType.STRING(42);
export const DataType_UINT256 = DataType.DECIMAL(78, 0);
export const DataType_USD_VALUE_DECIMALS = 4;
export const DataType_USD_VALUE = DataType.DECIMAL(
  18,
  DataType_USD_VALUE_DECIMALS,
);
export const DataType_HALF_STRING = DataType.STRING(127);
export const DataType_KECCAK256_HASHED_VALUE = DataType.STRING(66);
