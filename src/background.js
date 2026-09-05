import { EMPTY_STATS, MAX_CHARS, MATCHES, originPattern, supportedUrl, validateRules } from './shared.js';

let creating, statsQueue = Promise.resolve();
const receipts = new Map();
const trusted = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const settings = async () => {
  await trusted;
  return chrome.storage.local.get({ rules: [], sites: [], stats: EMPTY_STATS });
};

async function ensureEngine() {
  if (creating) { await creating; return; }
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  if (!creating) creating = chrome.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['WORKERS'], justification: 'Run the local WebGPU privacy model in a dedicated worker.',
  }).finally(() => { creating = null; });
  await creating;
}

async function engineStatus() {
  if (creating) await creating;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!contexts.length) return { phase: 'idle', progress: 0 };
  try {
    const status = await chrome.runtime.sendMessage({ target: 'engine', type: 'status' });
    return status?.phase ? status : { phase: 'loading', progress: 0 };
  } catch { return { phase: 'loading', progress: 0 }; }
}

async function registerSites(sites) {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  if (registered.some(s => s.id === 'extra-sites')) await chrome.scripting.unregisterContentScripts({ ids: ['extra-sites'] });
  const granted = [];
  for (const site of sites) if (await chrome.permissions.contains({ origins: [site] })) granted.push(site);
  if (granted.length) await chrome.scripting.registerContentScripts([{
    id: 'extra-sites', matches: granted, js: ['content.js'], runAt: 'document_start',
    allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true,
  }]);
}
chrome.runtime.onInstalled.addListener(async () => { await registerSites((await settings()).sites); });
chrome.runtime.onStartup.addListener(async () => { await registerSites((await settings()).sites); });

async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('INVALID');
  const isUI = ['popup.html', 'test.html'].some(p => sender.url === chrome.runtime.getURL(p));
  const isEngine = sender.url === chrome.runtime.getURL('offscreen.html');
  if (message.type === 'engine-status' && isEngine) {
    await chrome.action.setBadgeText({ text: message.status.phase === 'ready' ? '' : '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#111111' });
    return { ok: true };
  }
  if (message.type === 'filter' || message.type === 'commit') {
    const config = await settings();
    const url = sender.url?.startsWith('about:') ? sender.origin : sender.url;
    if (!isUI && (!sender.tab || !supportedUrl(url, config.sites))) throw new Error('INVALID');
    if (message.type === 'commit') {
      const receipt = receipts.get(message.receipt);
      if (!receipt || receipt.owner !== `${sender.tab?.id}:${sender.documentId}` || receipt.expires < Date.now()) throw new Error('INVALID');
      receipts.delete(message.receipt);
      statsQueue = statsQueue.catch(() => {}).then(async () => {
        const { stats } = await settings();
        await chrome.storage.local.set({ stats: {
          hidden: stats.hidden + receipt.hidden, characters: stats.characters + receipt.characters,
          pastes: stats.pastes + 1, last: receipt.hidden,
        } });
      });
      await statsQueue;
      return { ok: true };
    }
    if (typeof message.text !== 'string' || message.text.length > MAX_CHARS) throw new Error('TOO_LONG');
    if ((await engineStatus()).phase !== 'ready') throw new Error('NOT_READY');
    const response = await chrome.runtime.sendMessage({ target: 'engine', type: 'filter', text: message.text, rules: config.rules });
    if (!response?.ok) return response || { ok: false, code: 'SCAN_FAILED' };
    for (const [key, value] of receipts) if (value.expires < Date.now()) receipts.delete(key);
    const receipt = crypto.randomUUID();
    // Only counts are retained. No clipboard text, model output or entity values are saved.
    receipts.set(receipt, { owner: `${sender.tab?.id}:${sender.documentId}`, expires: Date.now() + 60000,
      hidden: response.result.hidden, characters: response.result.characters });
    return { ok: true, ...response.result, receipt };
  }
  if (!isUI) throw new Error('INVALID');
  switch (message.type) {
    case 'state': return { ok: true, ...await settings(), engine: await engineStatus() };
    case 'load': await ensureEngine(); return chrome.runtime.sendMessage({ target: 'engine', type: 'load' });
    case 'rules': await chrome.storage.local.set({ rules: validateRules(message.rules) }); return { ok: true };
    case 'reset-stats':
      statsQueue = statsQueue.catch(() => {}).then(() => chrome.storage.local.set({ stats: EMPTY_STATS }));
      await statsQueue; return { ok: true };
    case 'add-site': {
      const site = originPattern(message.url);
      if (!await chrome.permissions.contains({ origins: [site] })) throw new Error('PERMISSION');
      const config = await settings();
      const sites = [...new Set([...config.sites, site])].filter(s => !MATCHES.includes(s));
      await registerSites(sites);
      await chrome.storage.local.set({ sites });
      return { ok: true };
    }
    default: throw new Error('INVALID');
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'background') return;
  handle(message, sender).then(respond).catch(error => respond({ ok: false,
    code: ['NOT_READY', 'TOO_LONG', 'PERMISSION'].includes(error.message) ? error.message : 'FAILED' }));
  return true;
});
