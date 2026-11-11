/**
 * Pet page: single pet instance PetCard and multiple containers PetMulti. Not responsible for configuration analysis,
 * geometry, and physical calculations: the finished configuration is provided by host, and the pure logic comes from
 * shared. Modules such as react that depend on runtime injection, and shared's state, pickers, motion, physics and
 * other modules. Must always be true: / state is the only data source, and animation and bubbles are driven by changes
 * in the serial numbers in the leaves.
 * @module dsh-pet/src/client/pet
 */
import { injectPetCss } from './pet/css.ts';
import { createPetCard } from './pet/card/pet-card.ts';
import { createPetMulti } from './pet/multi.ts';
import type { PetRuntime } from './pet/types.ts';
import type { ReactNode } from 'react';

// The shape of the finished pet is shared by the container and the card, and its location is pet/types.ts. Only re-export is done here.
export type { RuntimePet } from './pet/types.ts';

/**
 * Create pet page component (factory), return multi-open container PetMulti.
 *
 * @param rt - Injected react capabilities.
 * @returns multi-open container component; multiple PetCard are rendered inside the container.
 */
export function makePetUI(rt: PetRuntime): () => ReactNode {
  injectPetCss();
  const PetCard = createPetCard(rt);
  const PetMulti = createPetMulti(rt, PetCard);
  return PetMulti;
}
