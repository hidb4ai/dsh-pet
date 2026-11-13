// SDK-free tests for request construction and independent stop attempts.
import { spawnSync } from 'node:child_process';
const python = process.env.ASTRA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, ['-I', '-B', 'runtime/astra/bridge_test.py'], { stdio: 'inherit' });
if (result.error) console.error(`Cannot run robot tests with ${python}: ${result.error.message}`);
process.exitCode = result.status ?? 1;
