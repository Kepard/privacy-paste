import { MAX_CHARS } from './shared.js';

// This script runs at document_start in Chrome's isolated world. Only the
// sanitized replacement is ever dispatched into the page's event handlers.
if (!globalThis.__privacyPasteInstalled) {
  globalThis.__privacyPasteInstalled = true;
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.target === 'content' && message.type === 'ping') respond({ active: true });
  });
  let busy = false, replacing = false, toast, hideTimer;
  const ERROR = {
    NOT_READY: 'Paste blocked. Open Privacy Paste and load the local model first.',
    TOO_LONG: 'Paste blocked. Use a smaller excerpt (up to 2,048 tokens / 16,000 characters).',
    BUSY: 'Paste blocked. Another local scan is running. Try again shortly.',
    ALIGNMENT: 'Paste blocked. The model could not map every character safely. Try a smaller excerpt.',
    TIMEOUT: 'Paste blocked. The local scan timed out. Try a smaller excerpt.',
  };
  function notify(message) {
    if (!toast?.isConnected) {
      toast = document.createElement('div');
      const root = toast.attachShadow({ mode: 'closed' });
      const box = document.createElement('div');
      box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
      box.style.cssText = 'font:13px/1.5 system-ui,sans-serif;color:#fff;background:#111;border:1px solid #666;border-radius:10px;padding:14px 18px;box-shadow:0 4px 24px #0003;';
      root.append(box);
      toast._box = box;
      toast.style.cssText = 'all:initial;position:fixed;right:20px;bottom:20px;max-width:380px;z-index:2147483647;pointer-events:none;';
      (document.documentElement || document).append(toast);
    }
    toast._box.textContent = message;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => toast?.remove(), 7000);
  }
  function editorFor(event) {
    for (const el of event.composedPath()) {
      if (!(el instanceof Element)) continue;
      if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement &&
          !['button', 'checkbox', 'radio', 'file', 'submit', 'reset', 'image', 'hidden', 'range', 'color'].includes(el.type))) return el;
      if (el.isContentEditable) {
        let root = el;
        while (root.parentElement?.isContentEditable) root = root.parentElement;
        return root;
      }
    }
    return null;
  }
  function snapshot(el) {
    if ('value' in el) return { value: el.value, start: el.selectionStart, end: el.selectionEnd };
    const s = el.getRootNode().getSelection?.() || window.getSelection();
    if (!s?.rangeCount || !el.contains(s.anchorNode) || !el.contains(s.focusNode)) throw new Error('Selection unavailable');
    return { html: el.innerHTML, anchor: s.anchorNode, anchorOffset: s.anchorOffset, focus: s.focusNode, focusOffset: s.focusOffset };
  }
  function unchanged(el, before) {
    if (!el.isConnected || el.disabled || el.readOnly) return false;
    const active = el.getRootNode().activeElement;
    if (active !== el && !el.contains(active)) return false;
    const after = snapshot(el);
    return Object.keys(before).every(key => before[key] === after[key]);
  }
  function insert(el, text, before) {
    // Rich editors (Lexical, ProseMirror, Quill) can consume a sanitized paste.
    // Native fields use their prototype setter to notify controlled React inputs.
    if (el.isContentEditable) {
      const data = new DataTransfer(); data.setData('text/plain', text);
      const accepted = el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, composed: true, cancelable: true, clipboardData: data }));
      if (!accepted) return true;
      return document.execCommand('insertText', false, text);
    }
    if (before.start === null || before.end === null) return document.execCommand('insertText', false, text);
    if (!el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType: 'insertFromPaste', data: text }))) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const next = before.value.slice(0, before.start) + text + before.value.slice(before.end);
    if (el.maxLength >= 0 && next.length > el.maxLength) return false;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, next);
    el.setSelectionRange(before.start + text.length, before.start + text.length);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertFromPaste', data: text }));
    return true;
  }

  window.addEventListener('paste', async event => {
    if (replacing) return;
    // Stop even pastes into custom/non-editable page surfaces: the provider's
    // own document-level handlers must not receive the original clipboard.
    event.preventDefault(); event.stopImmediatePropagation();
    const el = editorFor(event);
    if (!el || el.disabled || el.readOnly) { notify('Paste blocked. Choose an editable text field.'); return; }
    if (busy) { notify('A local scan is already running. Wait, then paste again.'); return; }
    if (event.clipboardData?.files.length) { notify('Paste blocked. Images and files cannot be scanned as text.'); return; }
    const text = event.clipboardData?.getData('text/plain');
    if (!text) { notify('Paste blocked. The clipboard has no plain text to scan.'); return; }
    if (text.length > MAX_CHARS) { notify(ERROR.TOO_LONG); return; }
    let before;
    try { before = snapshot(el); } catch { notify('Paste blocked. Select a position in the text field and try again.'); return; }
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    el.addEventListener('input', cancel); el.addEventListener('blur', cancel, true);
    busy = true;
    notify('Scanning locally… Your clipboard has not been pasted.');
    let timer;
    try {
      const response = await Promise.race([
        chrome.runtime.sendMessage({ target: 'background', type: 'filter', text }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), 95000); }),
      ]);
      if (!response?.ok) { notify(ERROR[response?.code] || 'Paste blocked. The local scan failed. Reload the extension and try again.'); return; }
      if (cancelled || !unchanged(el, before)) { notify('Paste cancelled because the field or selection changed. Paste again when ready.'); return; }
      replacing = true;
      let inserted;
      try { inserted = insert(el, response.text, before); } finally { replacing = false; }
      if (!inserted) { notify('Paste blocked. This editor did not accept safe insertion. Use the extension’s local test page to inspect filtered text.'); return; }
      await chrome.runtime.sendMessage({ target: 'background', type: 'commit', receipt: response.receipt }).catch(() => {});
      notify(`${response.hidden} sensitive ${response.hidden === 1 ? 'item' : 'items'} hidden · pasted locally filtered text.`);
    } catch { notify('Paste blocked. The local engine is unavailable. Open the extension or refresh this page.'); }
    finally {
      clearTimeout(timer); busy = false; replacing = false;
      el.removeEventListener('input', cancel); el.removeEventListener('blur', cancel, true);
    }
  }, true);
  window.addEventListener('beforeinput', event => {
    if (!replacing && event.inputType === 'insertFromPaste') { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('keydown', event => {
    if (busy && event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); notify('Wait for the local scan before sending.'); }
  }, true);
}
