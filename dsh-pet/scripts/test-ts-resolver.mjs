/**
 * Test process-specific module parsing hook: Complement the relative import without extension in src / to `.ts`
 * (including directory index).
 *
 * The shared layer is the source code for the packager (moduleResolution: Bundler). Compared with import, no extension
 * is written; the single test is node-experimental-strip-types directly connected to the source file. The ESM parser
 * of Node requires a complete specifier. Unifiedly adding the .ts suffix to the source files will affect the two
 * construction chains of tsdown and rolldown, so this layer is only added in the test process. Only the relative
 * specifier and directory index are added, and the bare package name is handed over to Node as it is.
 * @module dsh-pet/scripts/test-ts-resolver
 */
/** Complement `.ts` and `/index.ts` in sequence for relative import. If both fail, the original specifier will be returned to Node and an error will be reported. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (!/\.[cm]?[jt]sx?$/.test(specifier) && !specifier.endsWith('.json')) {
      for (const candidate of [specifier + '.ts', specifier + '/index.ts']) {
        try {
          return await nextResolve(candidate, context);
        } catch {
          /* Continue to try the next candidate; if it fails, fall back to the original specifier and let Node report its own error. */
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
