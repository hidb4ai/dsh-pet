/**
 * Single pet component: The assembly root gives rendering input, and this component only gives the input to the view.
 * No status is held and no judgment is made - the status is at card-state and the judgment is at each driver and
 * shared.
 * @module dsh-pet/src/client/pet/card/pet-card
 */
import { makeCardView } from './view.ts';
import { createCardRuntime } from './runtime.ts';
import type { PetCardProps } from './props.ts';
import type { PetRuntime } from '../types.ts';
import type { FunctionComponent } from 'react';

/**
 * Make pet card components.
 *
 * @param rt - Injected react capability.
 * @returns receives components of container props.
 */
export function createPetCard(rt: PetRuntime): FunctionComponent<PetCardProps> {
  const { h } = rt;
  /** DOM structure of pet card: only assemble, does not hold status. */
  const CardView = makeCardView({ h });
  const useCardRuntime = createCardRuntime(rt);

  /** Single pet instance, configuration is passed in by the container. */
  function PetCard(props: PetCardProps) {
    return h(CardView, useCardRuntime(props));
  }

  return PetCard;
}
