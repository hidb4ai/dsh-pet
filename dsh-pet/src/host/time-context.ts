/**
 * Public export of time background: combination results of time period, week and holiday, and time prefix of
 * historical messages.
 *
 * Only re-export; constants are in ./time-context/constants and holiday tables are in ./time-context/entries. Must
 * always be true: do not read the clock (Date is passed in by caller), invalid Date returns an empty string.
 * @module dsh-pet/src/host/time-context
 */
export { dayKindOf, timeSlotOf } from './time-context/constants.ts';
export type { TimeSlot } from './time-context/constants.ts';
export { historyStampOf, timeContextOf } from './time-context/context.ts';
