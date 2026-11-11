/**
 * The register table in the "live" (position + orientation) page: PetCard register reading method when mounting, for
 * Cordis read-only service `petApi7340` to read. The position on the web page is generated for each page: the pet is
 * in each viewport, and what is read is exactly the one on this page, without the need to instance id. Only serves the
 * browser side; not responsible for the host side's snapshots - desktop pets take their own `POST /pose/report` and
 * `GET /pose` . The coordinate conventions are exactly the same as `POST /position` (normalized center coordinates),
 * and are read on demand, not a snapshot when registering.
 * @module dsh-pet/src/client/pose
 */

/** A live broadcast: the normalized coordinates and orientation of the pet center. */
export type Pose = { x: number; y: number; facing: 'left' | 'right' };

/** petId → Function to get the current live view; PetCard is registered when mounted and removed when unmounted. */
const readers = new Map<string, () => Pose>();

/**
 * Register a pet's live reading on this page.
 * @param petId - Pet id.
 * @param read - function to get the current live stream.
 * @returns Remove function; repeated calls are harmless.
 */
export function registerPose(petId: string, read: () => Pose): () => void {
  readers.set(petId, read);
  return () => {
    // Only remove its own copy: When the same id is remounted, the copy of the later register cannot be mistakenly removed by the previous cleanup function.
    if (readers.get(petId) === read) readers.delete(petId);
  };
}

/**
 * Read the live status of a certain pet on this page; when it is not on this page (not registered / not mounted /
 * `display` does not include `web` ), it is `null` . It is synonymous with "clearly unavailable" on the desktop
 * `GET /pose` ; the current value is taken every time it is called, and it can be read during movement and dragging.
 */
export function readPose(petId: string): Pose | null {
  if (typeof petId !== 'string' || petId === '') return null;
  const read = readers.get(petId);
  return read === undefined ? null : read();
}

/** How many are currently registered (for testing and observation: verify that unmount does not leak). */
export function poseReaderCount(): number {
  return readers.size;
}
