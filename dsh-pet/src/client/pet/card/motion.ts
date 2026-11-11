/**
 * Motion assembly of a pet card: bounding box, geometry, autonomous positioning, throwing flight, position following
 * and collision site. Not responsible for pointers and menus: the drag driver is late-bound to the readback slot to
 * avoid forming a construction loop with the motion driver. The three sets of drivers are only built once. The rAF
 * handle and generation number are inside the driver and survive across renderings.
 * @module dsh-pet/src/client/pet/card/motion
 */
import { createFlight, type Flight, type FlightMetrics } from '../motion/flight.ts';
import { createHaptics, type Haptics } from '../haptics.ts';
import { canReadMotionSensors, shakeImpulse, subscribeShake, subscribeTilt, tiltGravity } from '../device-tilt.ts';
import { createPositionFollow, type PositionFollow } from '../motion/position-follow.ts';
import { createSquashDriver, type SquashDriver } from '../motion/squash.ts';
import { createWalk, type Walk } from '../motion/walk.ts';
import { landingSquash, throwVelocity } from '../../../shared/physics.ts';
import type { CardLive } from './live.ts';
import type { CardStateApi } from './state.ts';
import type { MovesConfig } from '../../../shared/types.ts';
import type { PetCollisionSlot } from '../../../shared/physics.ts';
import type { RuntimePet } from '../types.ts';
import type * as ReactNS from 'react';

/** Injected react capability. */
export interface CardMotionRuntime {
  /** side effect; collision between site register and logout. */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  /** Quote; Three sets of drivers are only built once. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}

/** Input of motion assembly. */
export interface CardMotionInput {
  /** Card status: the latest values of customized position, orientation and animation name. */
  card: CardStateApi;
  /** Latest value of resolved configuration. */
  cfgRef: ReactNS.MutableRefObject<RuntimePet>;
  /** Collision between pets. */
  arena: ReactNS.MutableRefObject<{ slots: Record<string, PetCollisionSlot> }>;
  /** Assemble root binding groove. */
  live: ReactNS.MutableRefObject<CardLive>;
  /** When frame geometry (configured dimensions are rolled out). */
  metrics: FlightMetrics;
  /** The moving pool of this pet. */
  moves: MovesConfig;
  /** This pet id: Use it for collision slot keys and flight elimination. */
  petId: string;
  /** Pet root node. */
  root: () => HTMLDivElement | null;
  /** After placement, submit to the normalization center and hand it over to React for rearrangement. */
  setCustomPos: CardStateApi['actions']['setCustomPos'];
  /** Change to walking action and play it once. */
  setOnce: (on: boolean) => void;
  /** Change to the specified animation. */
  setAnim: (anim: string) => void;
}

/** Products of motion devices: other modules are accessed on demand and the entire copy is not cached. */
export interface CardMotion {
  /** When frame geometry. */
  metrics: () => FlightMetrics;
  /** The viewport coordinates of the current pet center. */
  center: () => { x: number; y: number };
  /** Current bounding box position. */
  box: () => { x: number; y: number } | null;
  /** Write back bounding box position. */
  setBox: (box: { x: number; y: number }) => void;
  /** Stop-and-go position and position following. */
  stopMove: () => void;
  /** Take off from the given upper left corner and initial speed. */
  startThrow: (px: number, py: number, vx: number, vy: number) => void;
  /** Throwing command: angle (degree) and force multiplier. */
  applyThrow: (angleDeg: number, power: number) => void;
  /** Move independently. */
  walk: Walk;
  /** Throwing flight. */
  flight: Flight;
  /** Position following. */
  posFollow: PositionFollow;
  /** Q elastic extrusion. */
  squash: SquashDriver;
}

/**
 * hook of motion assembly.
 *
 * @param rt - Injected react capabilities.
 * @returns receives the assembly input hook and returns to the motion driving surface of this card.
 */
export function createCardMotion(rt: CardMotionRuntime) {
  const { useEffect, useRef } = rt;

  return function useCardMotion(input: CardMotionInput): CardMotion {
    const { arena, card, cfgRef, live, metrics, moves, petId, root, setAnim, setOnce, setCustomPos } = input;

    /** When frame movement parameters: the movement driver holds them for a long time and updates them in place every time it is rendered to avoid closing the size and animation pool into the old instance. */
    const motionRef = useRef<FlightMetrics>(metrics);
    motionRef.current = metrics;
    const movesRef = useRef<MovesConfig>(moves);
    movesRef.current = moves;

    /** Bounding box: shared with dragging and flying, whoever moves it will write back. */
    const boxRef = useRef<{ x: number; y: number } | null>(null);

    // Q bomb squeeze: rAF handle and generation number are inside the driver, and the image is restored according to the current orientation.
    const squashRef = useRef<SquashDriver | null>(null);
    squashRef.current ??= createSquashDriver({ facing: () => card.facingRef.current });
    const squash = squashRef.current;

    /** The viewport X coordinates of the current pet center. */
    const currentCenterX = (): number => {
      const cp = card.customPosRef.current;
      if (cp) return cp.rx * window.innerWidth;
      const rootEl = root();
      if (rootEl) return rootEl.getBoundingClientRect().left + motionRef.current.halfW;
      return window.innerWidth - 24 - motionRef.current.halfW;
    };
    /** The viewport Y coordinates of the current pet center. */
    const currentCenterY = (): number => {
      const cp = card.customPosRef.current;
      if (cp) return cp.ry * window.innerHeight;
      const rootEl = root();
      if (rootEl) return rootEl.getBoundingClientRect().top + motionRef.current.halfH;
      return window.innerHeight - 20 - motionRef.current.halfH;
    };

    const walkRef = useRef<Walk | null>(null);
    walkRef.current ??= createWalk({
      root,
      center: () => ({ x: currentCenterX(), y: currentCenterY() }),
      metrics: () => motionRef.current,
      moves: () => movesRef.current,
      facing: () => card.facingRef.current,
      viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
      isFlying: () => flightRef.current?.isFlying() ?? false,
      play: (name) => {
        setOnce(true);
        setAnim(name);
      },
      setBox: (box) => {
        boxRef.current = box;
      },
      commit: setCustomPos,
    });
    const walk = walkRef.current;

    /** Stop autonomous movement and position following. */
    const stopMove = (): void => {
      walkRef.current?.stop();
      // The position following spring also moves autonomously. It must be stopped when stopping and walking, otherwise the two sets of movements will change the DOM position at the same time.
      posFollowRef.current?.stop();
    };

    const flightRef = useRef<Flight | null>(null);
    /** Tactile feedback: one for each card, the cooling status follows the card; the switch reads the configuration in real time. */
    const hapticsRef = useRef<Haptics | null>(null);
    hapticsRef.current ??= createHaptics({ enabled: () => cfgRef.current.physics?.hapticEnabled !== false });
    const haptics = hapticsRef.current;
    flightRef.current ??= createFlight({
      root,
      metrics: () => motionRef.current,
      viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
      physics: () => cfgRef.current.physics,
      arena: () => arena.current,
      petId,
      box: () => boxRef.current,
      setBox: (box) => {
        boxRef.current = box;
      },
      commitLive: (center) => {
        card.customPosRef.current = center;
      },
      commitFinal: setCustomPos,
      onLanding: (impactVy) => {
        // After landing Q, the new first frame is pressed: wait for the foreground video to be in place before pressing.
        const frontEl = live.current.ownAnim.frontVideo();
        if (frontEl) live.current.squash.start(frontEl, landingSquash(impactVy));
      },
      onImpact: (impact) => {
        haptics.hit(impact.kind, impact.speed);
      },
      // Only read in resident (tilt) mode: Return to vertical gravity when tilt is not turned on or sampling has not been done, and the behavior is consistent with turning off somatosensory.
      gravity: () => {
        const physics = cfgRef.current.physics;
        const gravity = physics?.gravity ?? 0;
        if (physics?.tiltGravity !== true) return { gx: 0, gy: gravity };
        const sample = tiltSampleRef.current;
        const baseline = tiltBaselineRef.current;
        if (sample === null || baseline === null) return { gx: 0, gy: gravity };
        return tiltGravity(sample, baseline, gravity);
      },
    });
    const flight = flightRef.current;

    /** Somatosensory: sampling and neutral posture; both are clear when tilt is turned off. Turn it on again next time and recalibrate. */
    const tiltSampleRef = useRef<{ beta: number; gamma: number } | null>(null);
    const tiltBaselineRef = useRef<{ beta: number; gamma: number } | null>(null);

    /** Take off from the given upper left corner and initial speed; stop the spring following and moving first to avoid the two sets of movements changing positions at the same time. */
    const startThrow = (px: number, py: number, vx: number, vy: number): void => {
      live.current.drag.stopFollow();
      stopMove();
      flight.start(px, py, vx, vy);
    };

    /**
     * Put the speed on this pet: when running, it will be processed according to the given conventions, and when not
     * running, it will take off from the landing point.
     *
     * When not running, always start throwing instead of holding - holding is only pulled up by attitude sampling when
     * the tilt switch is on, otherwise when the gravity is non-zero, a permanent cycle will be left that can never
     * stop.
     *
     * @param vx - Horizontal velocity or impulse (px/s).
     * @param vy - Vertical velocity or impulse (px/s).
     * @param mode - `set` = absolute speed after settlement (collision); `add` = superimposed impulse (shake).
     */
    const applyVelocity = (vx: number, vy: number, mode: 'set' | 'add'): void => {
      if (flight.isFlying()) {
        if (mode === 'set') flight.setVelocity(vx, vy);
        else flight.impulse(vx, vy);
        return;
      }
      const at = boxRef.current ?? root()?.getBoundingClientRect() ?? null;
      if (at === null) return;
      startThrow(at.x, at.y, vx, vy);
    };
    /** The latest applyVelocity reference is used for collision slot and sensor callback forwarding to avoid stale closures. */
    const applyVelocityRef = useRef<(vx: number, vy: number, mode: 'set' | 'add') => void>(() => {});
    applyVelocityRef.current = applyVelocity;

    // Sensor subscribe is only created once: the two switches and physical parameters are read in each callback to avoid repeating the subscribe.
    useEffect(() => {
      if (!canReadMotionSensors()) return;
      const offTilt = subscribeTilt((sample) => {
        if (cfgRef.current.physics?.tiltGravity !== true) {
          tiltSampleRef.current = null;
          tiltBaselineRef.current = null;
          // Stop immediately when turning off the switch: If you are still running in the permanent mode, you will
          // continue to press the downward gravity to fall down. Only stop permanent - unconditional stop will press
          // down the flying throw together, and the sensor sampling is continuous.
          if (flight.isHeld()) flight.stop();
          return;
        }
        if (tiltBaselineRef.current === null) tiltBaselineRef.current = sample;
        tiltSampleRef.current = sample;
        if (live.current.drag.isActive() || flight.isFlying()) return;
        // Start only when it is really tilted: starting/stopping every frame when lying flat will cause an endless empty loop that cannot be stopped.
        const gravity = cfgRef.current.physics?.gravity ?? 0;
        const vector = tiltGravity(sample, tiltBaselineRef.current, gravity);
        if (vector.gx === 0 && vector.gy === 0) return;
        // Let go and follow before starting: two sets of drivers will shake when writing left/top at the same time, and the boxes that collide with each other will also be written garbled.
        stopMove();
        flight.startHeld();
      });
      const offShake = subscribeShake((ax, ay, az) => {
        const physics = cfgRef.current.physics;
        if (physics?.shakeThrow !== true) return;
        if (live.current.drag.isActive()) return;
        const impulse = shakeImpulse(ax, ay, az, physics.throwPower ?? 1);
        if (impulse !== null) applyVelocityRef.current(impulse.vx, impulse.vy, 'add');
      });
      return () => {
        offTilt();
        offShake();
        flight.stop();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Subscribe once; read toggles, physics and the driver through refs.
    }, []);

    const posFollowRef = useRef<PositionFollow | null>(null);
    posFollowRef.current ??= createPositionFollow({
      root,
      box: () => boxRef.current,
      setBox: (box) => {
        boxRef.current = box;
      },
      commit: setCustomPos,
      viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
      half: () => ({ w: motionRef.current.halfW, h: motionRef.current.halfH }),
      spring: () => cfgRef.current.physics.throwPower,
      isDragging: () => live.current.drag.isActive(),
      takeOver: () => {
        flightRef.current?.stop();
        walkRef.current?.stop();
        posFollowRef.current?.stop();
      },
    });
    const posFollow = posFollowRef.current;

    // Position and throwing instructions: seq is executed as soon as it changes, reuses the existing motion path, and does not write new kinematics.
    /**
     * Execute the throwing command: convert the angle (degree, 0 is positive right, counterclockwise is positive) and
     * force magnification into initial velocity and give it to startThrow. All downstream physics are reuse and there
     * is no dead zone.
     */
    const applyThrow = (angleDeg: number, power: number): void => {
      if (live.current.drag.isActive()) return; // User interaction takes priority.
      const { vx, vy } = throwVelocity(angleDeg, power);
      const box = boxRef.current ?? {
        x: currentCenterX() - motionRef.current.halfW,
        y: currentCenterY() - motionRef.current.halfH,
      };
      startThrow(box.x, box.y, vx, vy);
    };

    // Collision station register: getVel takes the latest speed, applyVelocity is forwarded by ref to avoid stale closure.
    const { size, bottomPad } = metrics;
    useEffect(() => {
      const arenaSlots = arena.current.slots;
      arenaSlots[petId] = {
        size,
        bottomPad,
        getBox: () => {
          if (boxRef.current) return boxRef.current;
          const r = root()?.getBoundingClientRect();
          return r ? { x: r.left, y: r.top } : null;
        },
        getVel: () => flight.velocity(),
        applyVelocity: (vx, vy) => applyVelocityRef.current(vx, vy, 'set'),
      };
      return () => {
        delete arenaSlots[petId];
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Collision registration depends on petId/size/bottomPad/arena. applyVelocity forwards through applyVelocityRef without captured render state; depending on it would reregister every render.
    }, [petId, size, bottomPad, arena]);

    const center = (): { x: number; y: number } => ({ x: currentCenterX(), y: currentCenterY() });

    live.current.walk = walk;
    live.current.flight = flight;
    live.current.posFollow = posFollow;
    live.current.squash = squash;
    live.current.center = center;
    live.current.stopMove = stopMove;

    return {
      applyThrow,
      box: () => boxRef.current,
      center,
      flight,
      metrics: () => motionRef.current,
      posFollow,
      setBox: (box) => {
        boxRef.current = box;
      },
      squash,
      startThrow,
      stopMove,
      walk,
    };
  };
}
