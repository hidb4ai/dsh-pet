/**
 * Click points: When a flying pet is clicked, points are calculated based on speed and size. The faster the speed and
 * the smaller the pet, the higher the points. We are not responsible for the judgment and display of compliance - the
 * threshold is judged by the caller, and the pop-up window and particles are at score-popup. Relies on constants's
 * base pet width converted size bonus.
 * @module dsh-pet/src/shared/score
 */
import { PET_REF_WIDTH } from './constants.ts';

/** Standard speed threshold (px/s): No points will be awarded if it is lower than it when clicked during flight (low-speed clicks maintain normal click animation). */
export const SCORE_MIN_SPEED = 400;

/** 1 point for every 100 px/s (under base size 462 px). */
const SCORE_SPEED_PER_POINT = 100;

/**
 * Click points: score = round ( speed/100 × 462/ size ), at least 1 point. Small pets have small targets and are more
 * difficult to hit while flying, but have higher scores; speed ≤ 0 or size ≤ 0 returns 0.
 */
export const clickScore = (speed: number, size: number): number => {
  if (speed <= 0 || size <= 0) return 0;
  return Math.max(1, Math.round((speed / SCORE_SPEED_PER_POINT) * (PET_REF_WIDTH / size)));
};
