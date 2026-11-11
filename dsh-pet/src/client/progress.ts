/**
 * The register table in the "Playback Progress" page: PetCard register reading method when mounting, for Cordis
 * read-only service `petApi7340` to read. Reading progress is a matter of every frame. To make HTTP, it means loopback
 * dozens of times per second; `<video>` attributes are read directly in the page, with zero request and zero
 * serialization. The playback state of the low frequency ( accepted / playing / ended / cancelled / failed ) is still
 * in `GET /playback/{id}` , that is the cross-process source of fact. Only serves the browser side; like pose, it is
 * read on demand. What you get is the status at this moment, not the snapshot when registering.
 * @module dsh-pet/src/client/progress
 */

/** A snapshot of the progress of a playback. All fields are taken from the foreground `<video>`. There is no cache or timer. */
export type PlaybackProgress = {
  /** The number of this playback; `null` = self-play animation (random movement/click/whisper/balance...), not a third-party playback request. */
  playbackId: string | null;
  /** Current animation name: action name or `url` playback request address; use whether `playbackId` is non-empty to identify third-party playback requests. */
  anim: string;
  /** Current playback position, seconds. */
  currentTime: number;
  /** Total video length, seconds; `0` when metadata is not ready. */
  duration: number;
  /** Whether to pause; the playback to the end is also `true`. */
  paused: boolean;
  /** Whether buffering: `readyState < 3` (HAVE_FUTURE_DATA) or seek. */
  buffering: boolean;
};

/** petId → Function to get the current progress; PetCard is registered when mounted and removed when unmounted. */
const readers = new Map<string, () => PlaybackProgress>();

/**
 * Register the progress of a pet on this page.
 * @param petId - Pet id.
 * @param read - function to get the current progress.
 * @returns Remove function; repeated calls are harmless.
 */
export function registerProgress(petId: string, read: () => PlaybackProgress): () => void {
  readers.set(petId, read);
  return () => {
    // Only remove its own copy: When the same id is remounted, the copy of the later register cannot be mistakenly removed by the previous cleanup function.
    if (readers.get(petId) === read) readers.delete(petId);
  };
}

/**
 * Read the playback progress of a certain pet on this page; when it is not on this page (not registered / not mounted
 * / `display` does not include `web` ), it is `null` . Each call takes the current value, and the position read during
 * playback is the position at that moment.
 */
export function readProgress(petId: string): PlaybackProgress | null {
  if (typeof petId !== 'string' || petId === '') return null;
  const read = readers.get(petId);
  return read === undefined ? null : read();
}

/** How many are currently registered (for testing and observation: verify that unmount does not leak). */
export function progressReaderCount(): number {
  return readers.size;
}
