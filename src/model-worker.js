import { pipeline, env } from '@huggingface/transformers';
import { MODEL, REVISION, MAX_TOKENS, MAX_CHARS } from './shared.js';
import { redact } from './redact.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('./vendor/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
  wasm: new URL('./vendor/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
};
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.logLevel = 40;

let classifier, loading, busy = false;
const status = (phase, progress = 0, code) => self.postMessage({ status: { phase, progress, code } });

async function loadModel() {
  if (classifier) return;
  if (loading) return loading;
  loading = (async () => {
    status('loading');
    if (!navigator.gpu || !await navigator.gpu.requestAdapter()) throw new Error('NO_GPU');
    classifier = await pipeline('token-classification', MODEL, {
      revision: REVISION, device: 'webgpu', dtype: 'q4',
      progress_callback: item => {
        if (item.status === 'progress_total') status('loading', Math.round(item.progress));
      },
    });
    const decode = classifier.tokenizer.decode.bind(classifier.tokenizer);
    classifier.tokenizer.decode = (ids, options = {}) => decode(ids, { ...options, clean_up_tokenization_spaces: false });
    status('ready', 100);
  })();
  try { await loading; }
  catch (error) { status('error', 0, error.message === 'NO_GPU' ? 'NO_GPU' : 'LOAD_FAILED'); throw error; }
  finally { loading = null; }
}

self.onmessage = async ({ data: { id, type, text, rules } }) => {
  try {
    if (type === 'load') { await loadModel(); self.postMessage({ id, ok: true }); return; }
    if (type !== 'filter') throw new Error('INVALID');
    if (!classifier) throw new Error('NOT_READY');
    if (busy) throw new Error('BUSY');
    if (typeof text !== 'string' || text.length > MAX_CHARS) throw new Error('TOO_LONG');
    busy = true;
    try {
      const encoded = classifier.tokenizer(text, { truncation: false });
      if (encoded.input_ids.size > MAX_TOKENS) throw new Error('TOO_LONG');
      const groups = await classifier(text, { aggregation_strategy: 'simple', ignore_labels: [] });
      const result = redact(text, groups, rules);
      self.postMessage({ id, ok: true, result });
    } finally { busy = false; }
  } catch (error) {
    const code = ['NOT_READY', 'BUSY', 'TOO_LONG', 'ALIGNMENT', 'NO_GPU'].includes(error.message) ? error.message : 'SCAN_FAILED';
    self.postMessage({ id, ok: false, code });
  }
};
