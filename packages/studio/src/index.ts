// Root entry is browser-safe (no pptxgenjs). The pptx mapper is exposed only on
// the './pptx' subpath so the web app can import types/registries without
// pulling a Node-only dependency into the bundle.
export * from './types.js';
export * from './layouts.js';
export * from './themes.js';
export * from './generation/prompt.js';
export * from './generation/parse.js';
// The Story model — the primary artifact. Slides are derived from it.
export * from './story/types.js';
export * from './story/color.js';
export * from './story/palettes.js';
export * from './story/compose.js';
export * from './story/derive.js';
export * from './story/prompt.js';
export * from './story/parse.js';
export * from './story/direct.js';
export * from './story/storyboard.js';
