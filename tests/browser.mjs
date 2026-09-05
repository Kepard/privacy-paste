// Deterministic integration tests. The ONLY mocked component is the model worker
// in a disposable copy. Production dist/ always contains the actual model.
import { chromium } from 'playwright';
import { cp, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(join(tmpdir(), 'privacy-paste-test-'));
const extension = join(temp, 'extension');
await cp('dist', extension, { recursive: true });
await writeFile(join(extension, 'model-worker.js'), `
self.onmessage = async ({data}) => {
 if(data.type === 'load') { self.postMessage({status:{phase:'ready',progress:100}}); return; }
 await new Promise(r=>setTimeout(r,350));
 if(data.text.includes('FAIL_SCAN')) { self.postMessage({id:data.id,ok:false,code:'SCAN_FAILED'}); return; }
 let text=data.text,hidden=0,characters=0;
 for(const [kind, value, label] of [['private_person','Alice Smith','NAME'],['private_email','alice@example.com','EMAIL']]) {
   if(data.rules.some(r=>r.kind===kind&&r.value===value)) continue;
   text=text.replaceAll(value,()=>{hidden++;characters+=value.length;return '['+label+']';});
 }
 self.postMessage({id:data.id,ok:true,result:{text,hidden,characters}});
};
`);
let context;
try {
  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    executablePath: process.env.CHROMIUM_PATH || undefined, channel: 'chromium', headless: true,
    env: { ...process.env, XDG_CONFIG_HOME: join(temp, 'config'), XDG_CACHE_HOME: join(temp, 'cache') },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#engine-label').filter({ hasText: 'NOT LOADED' }).waitFor();
  const page = await context.newPage();
  // Route a built-in provider hostname to a local fixture: no provider requests.
  await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
   <textarea id="plain"></textarea><input id="single"><input id="email" type="email">
   <div id="rich" contenteditable="true"></div><div id="framework" contenteditable="true"></div>
   <div id="shadow"></div><script>
   window.events=[]; window.inputs=[];
   window.addEventListener('paste', e=>events.push(e.clipboardData.getData('text/plain')),true);
   window.addEventListener('input', e=>inputs.push(e.data),true);
   document.getElementById('framework').addEventListener('paste',e=>{e.preventDefault();e.currentTarget.textContent=e.clipboardData.getData('text/plain');});
   document.getElementById('shadow').attachShadow({mode:'open'}).innerHTML='<textarea id="nested"></textarea>';
   </script></body></html>` }));
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://chatgpt.com' });
  await page.goto('https://chatgpt.com/privacy-paste-fixture');
  const raw = 'Alice Smith alice@example.com';
  async function paste(selector, text = raw, wait = true) {
    await page.locator(selector).focus();
    await page.evaluate(value => navigator.clipboard.writeText(value), text);
    await page.keyboard.press('Control+V');
    if (wait) await page.waitForTimeout(850);
  }
  const value = selector => page.locator(selector).inputValue();
  await paste('#plain');
  assert.equal(await value('#plain'), '', 'not-ready paste must be blocked');
  assert.deepEqual(await page.evaluate(() => events), [], 'page must not see raw paste events');
  console.log('PASS: trusted clipboard paste blocked before model readiness');
  const opening = await popup.evaluate(async () => {
    const load = chrome.runtime.sendMessage({ target: 'background', type: 'load' });
    const states = await Promise.all(Array.from({ length: 12 }, () => chrome.runtime.sendMessage({ target: 'background', type: 'state' })));
    await load;
    return states;
  });
  assert.ok(opening.every(s => s.ok && s.engine?.phase), 'status requests during engine creation must succeed');
  await popup.locator('#engine-label').filter({ hasText: 'READY' }).waitFor();
  await paste('#plain');
  assert.equal(await value('#plain'), '[NAME] [EMAIL]');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), raw, 'system clipboard unchanged');
  await page.locator('#single').fill('Before X after');
  await page.locator('#single').evaluate(el => el.setSelectionRange(7, 8));
  await paste('#single');
  assert.equal(await value('#single'), 'Before [NAME] [EMAIL] after');
  await paste('#rich');
  assert.equal(await page.locator('#rich').innerText(), '[NAME] [EMAIL]');
  await paste('#framework');
  assert.equal(await page.locator('#framework').innerText(), '[NAME] [EMAIL]');
  await paste('#nested');
  assert.equal(await value('#nested'), '[NAME] [EMAIL]');
  await paste('#email', 'alice@example.com');
  assert.equal(await value('#email'), '[EMAIL]');
  assert.ok((await page.evaluate(() => events)).every(t => !t.includes('Alice') && !t.includes('alice@')));
  assert.ok((await page.evaluate(() => inputs)).every(t => !t || !t.includes('Alice')));
  console.log('PASS: native, selection replacement, rich, framework-handled and shadow DOM insertion; raw text never reaches page handlers');
  await popup.locator('#value').fill('Alice Smith');
  await popup.locator('#rule-form button').click();
  await page.locator('#plain').fill('');
  await paste('#plain');
  assert.equal(await value('#plain'), 'Alice Smith [EMAIL]');
  console.log('PASS: exact name whitelist preserves name but redacts email');
  await page.locator('#plain').fill('');
  await paste('#plain', 'FAIL_SCAN');
  assert.equal(await value('#plain'), '');
  await paste('#plain', 'x'.repeat(16001));
  assert.equal(await value('#plain'), '');
  await paste('#plain', raw, false);
  await page.locator('#single').focus();
  await page.waitForTimeout(850);
  assert.equal(await value('#plain'), '', 'focus change must cancel insertion');
  await paste('#plain', raw, false);
  await page.keyboard.type('typed while scanning');
  await page.waitForTimeout(850);
  assert.equal(await value('#plain'), 'typed while scanning', 'user edits must cancel insertion');
  console.log('PASS: scan failures, oversized text, focus changes and typing during scan fail closed');
  const stats = await popup.evaluate(async () => (await chrome.runtime.sendMessage({ target: 'background', type: 'state' })).stats);
  assert.equal(stats.pastes, 7);
  assert.equal(stats.hidden, 12);
  const stored = await popup.evaluate(() => chrome.storage.local.get(null));
  assert.ok(!JSON.stringify(stored).includes('alice@example.com'), 'clipboard text must not be stored');
  console.log('PASS: statistics count accepted pastes, failures do not count, clipboard text is not persisted');
  if (process.env.SCREENSHOT_PATH) {
    await popup.setViewportSize({ width: 380, height: 880 });
    await popup.screenshot({ path: resolve(process.env.SCREENSHOT_PATH), fullPage: true });
  }
  console.log('All browser integration checks passed (deterministic model fixture).');
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
