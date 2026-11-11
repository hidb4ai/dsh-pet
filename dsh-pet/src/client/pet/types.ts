/**
 * The sharing type of the pet page: the injected react ability and the finished pet instance after being flattened.
 * @module dsh-pet/src/client/pet/types
 */
import type { Animations, Pet, PhysicsParams, Weights } from '../../shared/types.ts';
import type * as ReactNS from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { jsx } from 'react/jsx-runtime';

/** Runtime pet: the resolved value instance after being flattened, the entry-level fields have been completed and are required. */
export type RuntimePet = Pet & {
  animations: Animations;
  animationWeights: Weights;
  eventsRefreshSec: Record<string, number>;
  physics: PhysicsParams;
};

/** Injected react capabilities: Provided by the module factory, this directory does not directly import react runtime. */
export interface PetRuntime {
  /** Create element. */
  h: typeof jsx;
  /** Status. */
  useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
  /** side effect. */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  /** Quote. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}
