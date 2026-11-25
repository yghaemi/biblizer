// @ts-check
// How the loader gets the citation engine.
//
// This source version imports src/engine.js directly (used by tests).  The
// production build (build.mjs) replaces this module with one that imports
// dist/engine*.js next to the loader bundle at runtime, so citeproc and tippy
// are a separate file fetched only on pages that need them.

/**
 * @param {string} _scriptUrl  loader bundle URL (used by the build-time version)
 * @returns {Promise<typeof import('./engine.js')>}
 */
export const loadEngine = (_scriptUrl) => import("./engine.js");
