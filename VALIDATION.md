# Delivery validation

Verified on September 3, 2026.

## Completed checks

- Production build completes with all JavaScript and WebAssembly packaged locally.
- Eight Node tests pass for replacement, whitespace preservation, literal category-specific exceptions, repeated values, Unicode, fail-closed alignment, rule validation and exact host matching.
- Chromium 148.0.7778.96 and Brave 152.1.94.119 pass browser integration tests using temporary profiles and a deterministic model-worker fixture. Tests cover trusted clipboard pastes, textarea and single-line inputs, selection replacement, contenteditable insertion, an editor-handled sanitized paste, an open shadow-root field, unchanged system clipboard, blocked not-ready/failed/oversized pastes, focus/typing cancellation, counts and absence of clipboard text in persistent storage.
- Startup status requests during offscreen-page creation pass a regression check in Chromium. Text inputs with `type="email"` pass the native insertion path.
- The real pinned OpenAI model downloads and initializes inside the production extension, using WebGPU. In this environment, no hardware GPU was exposed; the smoke test used Chromium's SwiftShader software adapter.
- Actual model input: `My name is Alice Smith and my email is alice@example.com.` Output: `My name is [NAME] and my email is [EMAIL].` Two spans and 28 characters were hidden.
- An exact `Name → Alice Smith` exception preserves the sample name while still hiding the email.
- Actual inference succeeds with networking disabled after initialization.
- Destroying and recreating the inference context while offline successfully reloads the model from persistent browser cache and completes another scan.
- The actual tokenizer enforces the 2,048-token limit before inference.
- The popup was visually inspected and checked using agent-browser; no page errors were reported. `popup-preview.png` illustrates the UI with synthetic integration-test counts.

## Scope of verification

The integration tests route a provider hostname to a local fixture; they do not contact the provider. Logged-in live ChatGPT, Claude, Perplexity and other provider composers were not exhaustively tested. These products change independently. Follow the README's fictional-data checks on the sites and browser/GPU combination you use.

The model smoke tests validate local inference and selected behavior, not model accuracy across all categories, languages or documents. No hardware-GPU latency or memory benchmark was performed. Deterministic browser tests are explicitly separate from real-model tests.

`npm audit` reports Node-only upstream dependency findings documented in THIRD_PARTY_NOTICES.md. The affected Node image/archive libraries are not part of the browser extension bundle.

The package is an unpacked developer extension; Chrome Web Store / Brave store submission, review and signing were not performed.
