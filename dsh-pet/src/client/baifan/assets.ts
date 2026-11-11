/**
 * The five-segment animation names used for "Eating Rice": taken out from the configuration animations.baifan
 * according to the slot.
 *
 * Just take the name, not spell the address - the playback request takes the form of name of `/anim` . The address is
 * spelled by the renderer of each end according to the pet asset root (relative path on the web page, BASE issued by
 * the host on the desktop), so it does not depend on the page origin (origin on the desktop shell is not http). The
 * order of the slots is the gameplay contract: run to the bottom of the screen/run sideways after the rice/expect/eat
 * a bowl of rice/eat a ball.
 * @module dsh-pet/src/client/baifan/assets
 */

/** The five animation titles used for a show. */
export interface ActivityAssets {
  /** Run to the bottom of the screen (one-shot). */
  descend: string;
  /** Sideways running when chasing food (loop). */
  chase: string;
  /** Wait for the meal to be served after arriving (one-time use). */
  expect: string;
  /** Get a bowl of rice. */
  eatBowl: string;
  /** Eat rice balls. */
  eatBall: string;
}

/**
 * Get five animation names according to configuration.
 *
 * @param names - 5 animation names of `animations.baifan` (the order is the slot).
 * @returns five-segment animation name; when the configuration is missing, it is an empty string (caller is still
 * playback request, and is verified by the host by name).
 */
export function activityAssets(names: readonly string[]): ActivityAssets {
  return {
    descend: names[0] ?? '',
    chase: names[1] ?? '',
    expect: names[2] ?? '',
    eatBowl: names[3] ?? '',
    eatBall: names[4] ?? '',
  };
}
