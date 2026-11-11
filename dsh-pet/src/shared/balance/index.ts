/**
 * Balance's shared pure logic layer entry point: parse the balance leaves in / state, generate bubble row data, and
 * calculate pet stalls.
 *
 * It is not responsible for fetching the data - the balance is regularly refreshed by host and written to / state
 * (both ends share the same result), and it does not rely on React and DOM. It must always be true: if you don’t know
 * any specific service provider, if the parsing fails, null will be returned without throwing an exception (throwing
 * it once in 1 s polling will interrupt the whole shot).
 *
 * @module dsh-pet/src/shared/balance/index
 */

export * from './types.ts';
export * from './tone.ts';
export * from './parse.ts';
export * from './percent.ts';
export * from './view.ts';
export * from './notice.ts';

// Pattern display rules and public window tools.
export * from './handlers/index.ts';
export * from './handlers/windows.ts';
