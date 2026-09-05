// Optional real-model smoke test: downloads ~950 MB. No test doubles.
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(join(tmpdir(), 'privacy-paste-model-'));
const extension = resolve('dist');
let context;
try {
  context = await chromium.launchPersistentContext(process.env.MODEL_TEST_PROFILE || join(temp, 'profile'), {
    executablePath: process.env.CHROMIUM_PATH || undefined, channel: 'chromium', headless: true,
    env: { ...process.env, XDG_CONFIG_HOME: join(temp, 'config'), XDG_CACHE_HOME: join(temp, 'cache') },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox',
      ...(process.env.SOFTWARE_WEBGPU ? ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'rules', rules: [] }));
  await page.locator('#load').click();
  let state, lastPhase;
  const deadline = Date.now() + 12 * 60000;
  while (Date.now() < deadline) {
    state = await page.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'state' }));
    assert.equal(state?.ok, true, `State request failed: ${JSON.stringify(state)}`);
    const phase = JSON.stringify(state.engine);
    if (phase !== lastPhase) { console.log('Model:', phase); lastPhase = phase; }
    if (state.engine.phase === 'error') throw new Error(`Model initialization failed: ${phase}`);
    if (state.engine.phase === 'ready') break;
    await page.waitForTimeout(3000);
  }
  assert.equal(state.engine.phase, 'ready');
  const tooLong = await page.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'filter', text: 'x '.repeat(2200) }));
  assert.equal(tooLong.code, 'TOO_LONG', 'token cap must reject before inference');
  await page.goto(`chrome-extension://${id}/test.html`);
  const scan = () => page.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'filter', text: 'My name is Alice Smith and my email is alice@example.com.' }));
  const result = await scan();
  console.log('Actual model result:', result);
  assert.equal(result.ok, true);
  assert.ok(result.hidden >= 2);
  assert.ok(!result.text.includes('Alice Smith') && !result.text.includes('alice@example.com'));
  await page.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'rules', rules: [{ kind: 'private_person', value: 'Alice Smith' }] }));
  const allowed = await scan();
  assert.ok(allowed.ok && allowed.text.includes('Alice Smith') && !allowed.text.includes('alice@example.com'));
  await context.setOffline(true);
  assert.equal((await scan()).ok, true);
  console.log('PASS: actual WebGPU inference, exact-name exception, and offline inference.');
  // Recreate the inference context while offline to verify cached model reuse.
  await page.evaluate(() => chrome.offscreen.closeDocument());
  await page.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'load' }));
  const cacheDeadline = Date.now() + 3 * 60000;
  do {
    state = await page.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'state' }));
    if (state.engine.phase === 'ready' || state.engine.phase === 'error') break;
    await page.waitForTimeout(3000);
  } while (Date.now() < cacheDeadline);
  assert.equal(state.engine.phase, 'ready', 'cached model must initialize offline');
  assert.equal((await scan()).ok, true);
  console.log('PASS: offline model reinitialization from persistent browser cache.');
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
