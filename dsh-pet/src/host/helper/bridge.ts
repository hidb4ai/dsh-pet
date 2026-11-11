/**
 * Pipeline protocol of desktop Helper: renderer is a request and response shape forwarded by main.js.
 *
 * Both ends of the pipeline (host and Electron main process) align their message formats according to this file. It
 * must always be true: URL already contains the route prefix, and the host side must not spell it again.
 * @module dsh-pet/src/host/helper/bridge
 */

/** Protocol line prefix: The entire line starting with JSON in stdout/stdin belongs to the bridge protocol, and the rest are logs. */
export const BRIDGE_PREFIX = 'dsh-pet-bridge:';

/**
 * A request from renderer (forwarded by main.js): URL is / dsh-pet-7340 /... path + query string;
 * cb = main.js local callback server address (the host sends the response POST back; Electron main process cannot read
 * piped stdin, so the response does not go through pipe No. 0 - electron#4218)
 */
export interface BridgeRequest {
  id: number;
  method: string;
  url: string;
  body?: string;
  cb?: string;
}

/** The host responds to a request: json/text goes to body; the asset goes to file (the absolute path of the file, main.js reads the disk by itself). */
export interface BridgeResponse {
  id: number;
  status: number;
  contentType?: string;
  body?: string;
  file?: string;
}

/** bridge request processor (host side is connected to handlePetRoute; main.js does not bring out the host action when receiving a request). */
export type BridgeHandler = (req: BridgeRequest) => Promise<BridgeResponse>;
