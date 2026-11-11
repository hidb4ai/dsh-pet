/**
 * Test entry point preloading: convert test-ts-resolver register into module parsing hook. Only register, without
 * changing the parsing strategy or injecting global variables. The test script of package.json is introduced with --
 * import and is only effective for the test process.
 * @module dsh-pet/scripts/test-register
 */
import { register } from 'node:module';

register('./test-ts-resolver.mjs', import.meta.url);
