/** Exercise the extracted Windows app and its bundled worker through real Electron. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const [executablePath, address, output] = process.argv.slice(2);
const home = join(output, 'home');
await mkdir(join(home, 'dsh-pet'), { recursive: true });
const app = await electron.launch({
  executablePath,
  env: { ...process.env, DSH_HOME: home, PYTHONHOME: join(output, 'invalid-python'), PYTHONPATH: output },
  timeout: 60_000,
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const site = await app.evaluate(() => process.env.DSH_PET_SITE_URL);
  const url = new URL(site);
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  assert.ok(token, 'The packaged app must create its authenticated local session');
  const request = async (body) => {
    const response = await fetch(`${url.origin}/dsh-pet-7340/robot`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-DSH-Pet-Token': token },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const initial = await request();
  assert.equal(initial.config.python, 'bundled');
  assert.equal(initial.config.enabled, false);
  assert.equal(
    (await request({ action: 'configure', config: { ...initial.config, enabled: true, address } })).ok,
    true,
  );
  let snapshot;
  for (let attempt = 0; attempt < 40; attempt++) {
    snapshot = await request({ action: 'check' });
    if (snapshot.connected) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(snapshot.connected, true, JSON.stringify(snapshot));
  assert.equal(snapshot.telemetry.description, 'Bundled host probe');
  assert.equal(snapshot.armed, false);
  await page.screenshot({ path: join(output, 'desktop.png') });
  await writeFile(join(output, 'result.json'), JSON.stringify({ windowLoaded: true, bundledSdkStatus: true }) + '\n');
  console.log('Extracted Windows app -> ASAR host -> private Python -> SDK status: passed');
} finally {
  await app.close();
}
