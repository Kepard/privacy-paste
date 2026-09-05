# Third-party notices

- OpenAI Privacy Filter: Apache License 2.0. Model files are downloaded directly from the pinned revision on Hugging Face and are not redistributed in this package. https://huggingface.co/openai/privacy-filter
- Hugging Face Transformers.js 4.2.0: Apache License 2.0. The distribution includes `TRANSFORMERS-LICENSE` and retains bundle license comments.
- Hugging Face Tokenizers and Jinja: Apache License 2.0; bundled through Transformers.js.
- Microsoft ONNX Runtime Web: MIT. See `ONNX-RUNTIME-LICENSE` in the distribution.
- The WebML Community Privacy Filter demo informed the choice of model and inference API. Its visual design, sample dataset, audio and application source were not copied.

The build's npm dependency tree also includes Node-only image and ONNX packages from Transformers.js. They are not included in the browser bundle. At delivery, `npm audit` reported four high-severity dependency findings through `sharp`/libvips and `onnxruntime-node`/`adm-zip`; the pinned upstream Transformers.js release did not provide a compatible fix. The extension does not execute those Node-only packages or parse images/archives with them at runtime. Review upstream releases before updating dependencies or publishing to a store.
