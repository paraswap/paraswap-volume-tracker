export const SCRIPT_START_TIME_SEC = Math.round(Date.now() / 1000); // stable script start time to align stakes and transactions fetching time intervals
export const OFFSET_CALC_TIME = 5 * 60; // delay to ensure that all third parties providers are synced + protection against reorg
