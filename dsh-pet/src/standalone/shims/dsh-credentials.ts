/**
 * Standalone mode stand-in for `@deepseek-ai/dsh-credentials` .
 *
 * The plugin only uses credentialRef to construct the reference, and the certificate parsing in standalone mode is
 * always empty, so the reference itself does not need a structure and can be returned as is; the remaining route will
 * take the clear failure branch. Only effective in standalone mode builds, pointed to by alias.
 * @module dsh-pet/src/standalone/shims/dsh-credentials
 */

/** Return the reference as is: standalone mode does not parse credentials and only ensures that the module graph can be loaded. */
export function credentialRef(ref: unknown): unknown {
  return ref;
}
