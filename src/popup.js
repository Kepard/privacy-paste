import { KINDS, originPattern, supportedUrl } from './shared.js';
const $ = id => document.getElementById(id);
const send = (type, data = {}) => chrome.runtime.sendMessage({ target: 'background', type, ...data });
let state, tab;
for (const [kind, name] of Object.entries(KINDS)) $('kind').add(new Option(name, kind));
const notice = text => { $('notice').textContent = text; };

function drawRules() {
  $('rules').replaceChildren();
  $('rule-count').textContent = `${state.rules.length} exceptions`;
  for (const [index, rule] of state.rules.entries()) {
    const li = document.createElement('li'), value = document.createElement('span'), kind = document.createElement('small'), remove = document.createElement('button');
    kind.textContent = KINDS[rule.kind]; value.append(kind, document.createTextNode(rule.value));
    remove.textContent = '×'; remove.setAttribute('aria-label', `Remove exception ${rule.value}`);
    remove.addEventListener('click', async () => {
      const rules = state.rules.filter((_, i) => i !== index);
      if ((await send('rules', { rules })).ok) { state.rules = rules; drawRules(); }
    });
    li.append(value, remove); $('rules').append(li);
  }
}

async function refresh(initial = false) {
  const next = await send('state');
  if (!next?.ok) { notice('Extension unavailable. Reload it and refresh the website.'); return; }
  const rulesChanged = JSON.stringify(state?.rules) !== JSON.stringify(next.rules);
  state = next;
  $('hidden').textContent = state.stats.hidden.toLocaleString();
  $('summary').textContent = `${state.stats.characters.toLocaleString()} characters · ${state.stats.pastes.toLocaleString()} filtered pastes`;
  const { phase, progress = 0, code } = state.engine;
  $('engine-label').textContent = ({ idle: 'NOT LOADED', loading: 'LOADING', ready: 'READY', error: 'UNAVAILABLE' })[phase] || 'UNAVAILABLE';
  $('engine-detail').textContent = phase === 'ready' ? 'Ready. Pasted text is scanned on this device.' : phase === 'loading' ? (progress >= 100 ? 'Download complete. Preparing the GPU…' : `Loading model · ${progress}%. You can close this popup.`) : code === 'NO_GPU' ? 'WebGPU is unavailable. Enable hardware acceleration and restart your browser.' : phase === 'error' ? 'Loading failed. Check your connection, GPU and available memory, then retry.' : 'Pastes stay blocked until the local model is ready.';
  $('progress').hidden = phase !== 'loading'; $('progress').value = progress;
  $('load').hidden = phase === 'ready'; $('load').disabled = phase === 'loading';
  $('load').textContent = phase === 'error' ? 'Retry loading model' : phase === 'loading' ? 'Loading locally…' : 'Load local model';
  if (initial || rulesChanged) drawRules();
  if (initial) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const covered = supportedUrl(tab?.url, state.sites);
    let active = false;
    if (covered) {
      try { active = (await chrome.tabs.sendMessage(tab.id, { target: 'content', type: 'ping' }, { frameId: 0 }))?.active === true; } catch {}
    }
    $('site-name').textContent = (() => { try { return new URL(tab.url).hostname; } catch { return 'No website selected'; } })();
    $('site-status').textContent = active ? 'ACTIVE' : covered ? 'RELOAD TAB' : 'NOT COVERED';
    let canAdd = false; try { originPattern(tab.url); canAdd = !covered; } catch {}
    $('add-site').hidden = !canAdd;
    $('site-help').textContent = active ? 'Paste interception is active on this page. The model must be ready before a paste can proceed.' : covered ? 'Reload this tab to activate protection. If this persists, grant site access in the browser’s extension settings.' : 'Built in: ChatGPT, Claude, Perplexity, Gemini, Copilot, Grok, Poe, Mistral, DeepSeek and Qwen.';
  }
}

$('load').addEventListener('click', async () => { $('load').disabled = true; await send('load'); await refresh(); });
$('rule-form').addEventListener('submit', async event => {
  event.preventDefault();
  const rule = { kind: $('kind').value, value: $('value').value.trim() };
  if (!rule.value) return;
  if (state.rules.some(r => r.kind === rule.kind && r.value === rule.value)) { notice('That exception already exists.'); return; }
  const rules = [...state.rules, rule];
  if (!(await send('rules', { rules })).ok) { notice('Could not save. Use at most 100 exceptions.'); return; }
  state.rules = rules; $('value').value = ''; drawRules(); notice('Exception saved on this device.');
});
$('add-site').addEventListener('click', async () => {
  try {
    const origins = [originPattern(tab.url)];
    if (!await chrome.permissions.request({ origins })) { notice('Website access was not granted.'); return; }
    if (!(await send('add-site', { url: tab.url })).ok) throw new Error();
    await refresh(true); notice('Website added. Reload the website to activate paste protection.');
  } catch { notice('Could not add this website.'); }
});
$('test').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('test.html') }));
$('reset').addEventListener('click', async () => { await send('reset-stats'); await refresh(); notice('Counts reset.'); });
await refresh(true);
setInterval(() => refresh().catch(() => {}), 1200);
