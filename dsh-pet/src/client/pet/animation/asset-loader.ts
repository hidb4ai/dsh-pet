/**
 * Asset bytes loading: Get an animation asset into a playable blob address, with timeout and in-transit registration.
 * Get the whole file at once instead of letting video stream load - the latter occasionally stalled on DSH WebServer,
 * which behaves like no response after clicking. It is only responsible for "getting the address" and "releasing the
 * address"; which segment to play and which slot A/B belongs to the animation chain. cache uses the default policy:
 * the server gives max-age and does not use the network during the validity period; force-cache cannot be used,
 * otherwise the old cache will still be read after replacing the asset with the same name.
 * @module dsh-pet/src/client/pet/animation/asset-loader
 */
/** Two endings in one load. */
export interface AssetHandlers {
  /** Get the object address that can be directly assigned to `video.src`; the caller is responsible for `release` later. */
  onObjectUrl: (objectUrl: string) => void;
  /** Unable to get bytes (timeout, non-2 xx, interrupted); caller decides whether to report. */
  onError: (error: unknown) => void;
}

/** asset loader. */
export interface AssetLoader {
  /** Get asset once. */
  load: (url: string, handlers: AssetHandlers) => void;
  /** Interrupt all in-flight requests (unmount timeout). */
  abortAll: () => void;
  /** Release the address of an object created by this loader. */
  release: (objectUrl: string) => void;
}

/**
 * Create asset loader.
 *
 * @param timeoutMs - The timeout of a single request (ms); it will be interrupted when it reaches the point to avoid
 * the request from hanging indefinitely.
 * @returns loading, batch interrupt and release.
 */
export function createAssetLoader(timeoutMs: number): AssetLoader {
  /** Requests in transit: uniformly interrupted when destroyed, otherwise the response completed after unmount will create an address that no one will reclaim. */
  const inflight = new Set<AbortController>();

  return {
    load: (url, handlers) => {
      const controller = new AbortController();
      inflight.add(controller);
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      const settle = (): void => {
        window.clearTimeout(timer);
        inflight.delete(controller);
      };
      fetch(url, { cache: 'default', signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error('asset HTTP ' + response.status);
          return response.blob();
        })
        .then((blob) => {
          settle();
          handlers.onObjectUrl(URL.createObjectURL(blob));
        })
        .catch((error: unknown) => {
          settle();
          handlers.onError(error);
        });
    },
    abortAll: () => {
      for (const controller of inflight) controller.abort();
      inflight.clear();
    },
    release: (objectUrl) => {
      URL.revokeObjectURL(objectUrl);
    },
  };
}
