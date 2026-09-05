import { build } from 'esbuild';
import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { MATCHES } from '../src/shared.js';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/vendor', { recursive: true });
await cp('public', 'dist', { recursive: true });
const common = { bundle: true, platform: 'browser', target: 'chrome120', sourcemap: false, legalComments: 'eof' };
await build({ ...common, entryPoints: ['src/background.js', 'src/offscreen.js', 'src/model-worker.js', 'src/popup.js', 'src/test-page.js'], outdir: 'dist', format: 'esm' });
await build({ ...common, entryPoints: ['src/content.js'], outfile: 'dist/content.js', format: 'iife' });
// MV3 executes only locally packaged JS / WASM, never CDN scripts or blob modules.
for (const name of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  await cp(`node_modules/onnxruntime-web/dist/${name}`, `dist/vendor/${name}`);
}
await cp('node_modules/@huggingface/transformers/LICENSE', 'dist/TRANSFORMERS-LICENSE');
await cp('public/ONNX-RUNTIME-LICENSE', 'dist/ONNX-RUNTIME-LICENSE');
const manifest = {
  manifest_version: 3, name: 'Privacy Paste', version: '1.0.0', minimum_chrome_version: '120',
  description: 'Redact personal information before pasting on AI websites. OpenAI Privacy Filter runs locally with WebGPU.',
  permissions: ['storage', 'offscreen', 'scripting', 'activeTab', 'unlimitedStorage'],
  host_permissions: [...MATCHES, 'https://huggingface.co/*', 'https://*.hf.co/*'],
  optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  background: { service_worker: 'background.js', type: 'module' },
  action: { default_popup: 'popup.html', default_title: 'Privacy Paste' },
  icons: { 16: 'icons/16.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  content_scripts: [{ matches: MATCHES, js: ['content.js'], run_at: 'document_start', all_frames: true, match_origin_as_fallback: true }],
  content_security_policy: { extension_pages: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'none'; connect-src 'self' https://huggingface.co https://*.hf.co; style-src 'self'; img-src 'self';" },
};
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('Built dist/. Load that folder as an unpacked Chrome / Brave extension.');
