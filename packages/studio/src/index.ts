// Root entry is browser-safe (no pptxgenjs). The pptx mapper is exposed only on
// the './pptx' subpath so the web app can import types/registries without
// pulling a Node-only dependency into the bundle.
export * from './types.js';
export * from './layouts.js';
export * from './themes.js';
export * from './generation/prompt.js';
export * from './generation/parse.js';
