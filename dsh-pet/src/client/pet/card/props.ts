/**
 * Rendering input for a single pet: The container distributes / state leaves into these fields, and the card read-only
 * does not write. The fields all come from the container (polling, configuration, collision site), and there is no
 * subscribe event inside the card - it is only responsible for rendering and responding. When the React state needs to
 * be changed, go to its own setter, and callback is not required.
 * @module dsh-pet/src/client/pet/card/props
 */
import type * as ReactNS from 'react';
import type { BalanceState } from '../../../shared/balance/index.ts';
import type { PetCollisionSlot } from '../../../shared/physics.ts';
import type { LockState, PositionMode, SayCue, PetFacing, SleepState } from '../../../shared/state.ts';
import type { MenuMoreItem } from '../../../shared/menu.ts';
import type { WorkStatusSnapshot } from '../../../shared/work-status.ts';
import type { RuntimePet } from '../types.ts';

/** Rendering input for a pet card. */
export interface PetCardProps {
  /** Finished product configuration. */
  cfg: RuntimePet;
  /** The latest balance result. */
  balance: BalanceState | null;
  /** The number of times the balance is successfully pulled, and the state animation is played when it changes. */
  balanceTick: number;
  /** Number of reminders for unavailable balance. */
  balanceNoticeTick: number;
  /** Is this balance requested manually by the user? The manual request will be answered even if balanceEnabled is closed. */
  balanceManual: boolean;
  /** Working status snapshot. */
  workStatus: WorkStatusSnapshot | null;
  /** Number of working status changes. */
  workStatusTick: number;
  /** When clicking a work bubble, it jumps to the session to which it belongs; by default, the bubble cannot be clicked (the desktop is forwarded by the container). */
  onFocusSession?: (sessionId: string) => void;
  /** The speaking command of this pet; when kind is clear, put away the bubble, and pop the bubble otherwise. */
  say?: SayCue & { seq: number };
  /** Number of speaking command changes. */
  sayTick: number;
  /** The playback request command of this pet: name and url are exactly one; facing maintains the current orientation when not specified. */
  animCue?: { name?: string; url?: string; seq: number; playbackId?: string; facing?: PetFacing };
  /** The number of playback request command changes. */
  animCueTick: number;
  /** The position command of this pet: x/y is the normalized coordinate of the pet center, duration is only valid in line mode. */
  posCue?: { x: number; y: number; mode: PositionMode; duration: number; seq: number };
  /** Number of position command changes. */
  posCueTick: number;
  /** The throwing command of this pet: angle The unit is degrees, 0 is right and counterclockwise is positive. */
  throwCue?: { angle: number; power: number; seq: number };
  /** Number of changes in throwing instructions. */
  throwCueTick: number;
  /** The lock occupied by this pet; expiresAt is the only expired truth, and the host will not push "Lock is gone". */
  lock?: LockState;
  /** Number of lock leaf changes. */
  lockTick: number;
  /** The sleeping state of this pet: the three-part name is selected by the host; when sleeping, the random chain stops and the source automatically shuts up. */
  sleep?: SleepState;
  /** Number of sleeping leaf changes. */
  sleepTick: number;
  /** Third-party menu item snapshot; ref is passed because it is only read at the moment of right-clicking. */
  menuItemsRef: ReactNS.MutableRefObject<MenuMoreItem[]>;
  /** Collision between pets. */
  arena: ReactNS.MutableRefObject<{ slots: Record<string, PetCollisionSlot> }>;
}
