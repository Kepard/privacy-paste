const pending = new Map();
const worker = new Worker(chrome.runtime.getURL('model-worker.js'), { type: 'module' });
let current = { phase: 'idle', progress: 0 };
worker.onmessage = ({ data }) => {
  if (data.status) {
    current = data.status;
    chrome.runtime.sendMessage({ target: 'background', type: 'engine-status', status: current }).catch(() => {});
    return;
  }
  const job = pending.get(data.id);
  if (job) { clearTimeout(job.timer); pending.delete(data.id); job.respond(data); }
};
worker.onerror = () => {
  current = { phase: 'error', code: 'ENGINE_FAILED' };
  chrome.runtime.sendMessage({ target: 'background', type: 'engine-status', status: current }).catch(() => {});
  for (const { respond, timer } of pending.values()) { clearTimeout(timer); respond({ ok: false, code: 'ENGINE_FAILED' }); }
  pending.clear();
};
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'engine') return;
  if (message.type === 'status') { respond(current); return; }
  if (message.type === 'load') { worker.postMessage({ id: crypto.randomUUID(), type: 'load' }); respond({ ok: true }); return; }
  if (message.type !== 'filter') return;
  const id = crypto.randomUUID();
  const timer = setTimeout(() => {
    pending.delete(id);
    respond({ ok: false, code: 'TIMEOUT' });
  }, 90000);
  pending.set(id, { respond, timer });
  worker.postMessage({ id, type: 'filter', text: message.text, rules: message.rules });
  return true;
});
