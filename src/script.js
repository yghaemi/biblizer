// @ts-check
// Loader entry (dist/script*.js): resolves the page, fetches its reference
// settings, and imports the citation engine (dist/engine*.js) only when this
// page has citations or a bibliography to render.
/**
 * @typedef {import('./types').PageInfo} PageInfo
 */

import { API_BASE, FALLBACK_SCRIPT_URL, LIBRARY, extractLibrary } from "./config.js";
import { fetchCurrentPageId, fetchJSON, getGlobalSettingsPageId, getReferences } from "./api.js";
import { collectScopeRefs } from "./toc.js";
import { isGroupTarget, referenceOutputId, removeForeignReferenceOutputs } from "./containers.js";
import { loadEngine } from "./engineLoader.js";
import { escapeHtml, termAnchorId } from "./utils.js";

// URL this bundle was loaded from — the base for engine.js and ../src/csl/.
// Must be read now, while the <script> is executing: document.currentScript
// is null once DOMContentLoaded fires.
const SCRIPT_URL =
  /** @type {HTMLScriptElement|null} */ (document.currentScript)?.src ||
  FALLBACK_SCRIPT_URL;

// ─── Main ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // Prefer the page id MindTouch embeds in #mt-global-settings; fall back to
  // resolving the address-bar path through the Deki API.  Either way the id
  // is the page actually being viewed, even when content is transcluded.
  const settingsPageId = getGlobalSettingsPageId();
  const pageIdPromise = settingsPageId
    ? Promise.resolve(settingsPageId)
    : fetchCurrentPageId(LIBRARY).catch((err) => {
        console.warn("Deki pageID lookup failed:", err);
        return null;
      });
  const pageID = await pageIdPromise;
  if (!pageID) {
    console.error(
      "no pageID available (#mt-global-settings and Deki lookup both failed); skipping render",
    );
    return;
  }

  // Bibliography containers carried in by transcluded pages belong to those
  // pages, not this one.
  removeForeignReferenceOutputs(pageID);

  try {
    /** @type {PageInfo} */
    const pageInfo = await fetchJSON(
      `${API_BASE}/page/${pageID}/library/${LIBRARY}`,
    );
    const { displayLocation } = pageInfo;

    // Only chapter and backmatter scopes can render without a visible marker
    // on this page; anything else with no markers has nothing to do.
    const hasMarkers = document.body.textContent.includes("\\librecite{");
    if (!hasMarkers && displayLocation !== "endOfChapter" && displayLocation !== "backmatter") {
      return;
    }

    const { referenceItems, toc } = await getReferences(
      pageInfo.projectID,
      pageInfo.lastUpdatedAt,
    );
    const scopeRefs = collectScopeRefs(
      displayLocation,
      toc,
      pageID,
      pageInfo.backmatterReferenceList,
      pageInfo.scope?.groups,
    );
    if (!hasMarkers && !rendersScopeBibliography(pageID, pageInfo, scopeRefs)) return;

    const { renderCitations } = await loadEngine(SCRIPT_URL);
    await renderCitations({ pageID, pageInfo, referenceItems, toc, scopeRefs, scriptUrl: SCRIPT_URL });
  } catch (err) {
    console.error("Failed to load citations:", err);
  }
});

/**
 * Whether a page with no visible markers still shows a bibliography: the
 * same conditions the engine uses to pick a container, plus a non-empty scope.
 * @param {string} pageID
 * @param {PageInfo} pageInfo
 * @param {string[]} scopeRefs
 * @returns {boolean}
 */
function rendersScopeBibliography(pageID, pageInfo, scopeRefs) {
  if (scopeRefs.length === 0) return false;
  switch (pageInfo.displayLocation) {
    case "endOfChapter":
      return (
        isGroupTarget(pageID, pageInfo.displayGroups, pageInfo.scope?.groups) ||
        !!document.getElementById(referenceOutputId(pageID))
      );
    case "backmatter":
      return pageID === String(pageInfo.backmatterPageID);
    default:
      return false;
  }
}

// Expose utilities that other LibreTexts page scripts may call directly.
globalThis.termAnchorId = termAnchorId;
globalThis.escapeHtml = escapeHtml;

export { extractLibrary };
