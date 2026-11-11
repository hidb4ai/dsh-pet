/**
 * Time constant of pet page: bubble display duration and / state polling rhythm. They are all written as named
 * constants instead of scattered at the call point: the bubble duration is decoupled from the animation lifecycle, and
 * the polling interval determines the request frequency when idle.
 * @module dsh-pet/src/client/pet/timings
 */

/** The display duration of the balance and work status bubble (ms) is decoupled from the animation lifecycle. */
export const BUBBLE_DURATION_MS = 10 * 1000;

/** `/state` long polling suspension duration (ms): about 1 request/second when idle. If there is a change, the host will return immediately. */
export const STATE_WAIT_MS = 1000;

/** Polling interval (ms) when the old host or request fails; without backing off, it will become busy waiting. */
export const STATE_FALLBACK_MS = 1000;
