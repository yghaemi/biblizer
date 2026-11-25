// @ts-check
// Entry point: wires the modules together and runs on DOMContentLoaded.
/**
 * @typedef {import('./types').PageInfo}          PageInfo
 * @typedef {import('./types').ReferenceItem}     ReferenceItem
 * @typedef {import('./types').ProjectData}       ProjectData
 * @typedef {import('./types').TocNode}           TocNode
 * @typedef {import('./types').ScopeGroup}        ScopeGroup
 * @typedef {import('./types').CachedProjectData} CachedProjectData
 * @typedef {import('./types').FormatConfig}      FormatConfig
 * @typedef {import('./types').CslAuthor}         CslAuthor
 * @typedef {import('./types').CslDate}           CslDate
 * @typedef {import('./types').CslJson}           CslJson
 * @typedef {import('./types').CitationInstance}  CitationInstance
 * @typedef {import('./types').NodeCitationMeta}  NodeCitationMeta
 * @typedef {import('./types').CiteprocEngine}    CiteprocEngine
 */

import tippyCss from "tippy.js/dist/tippy.css";
import { API_BASE, LIBRARY, extractLibrary, getFormatConfig } from "./config.js";
import { fetchCurrentPageId, fetchJSON, getGlobalSettingsPageId, getReferences } from "./api.js";
import { buildBibHtmlMap, buildCiteprocEngine, loadCslStyle, processCitationsWithCiteproc } from "./csl.js";
import { toCslJson } from "./convert.js";
import { buildRefUsageMap, collectScopeRefs } from "./toc.js";
import { collectAllCitationInstances, injectCitationMarkers, replaceAllCitationMarkers } from "./citations.js";
import {
  appendReferencesSection,
  getOrCreateReferenceOutput,
  isGroupTarget,
  referenceOutputId,
  removeForeignReferenceOutputs,
  whenElementPresent,
} from "./bibliography.js";
import { escapeHtml, termAnchorId } from "./utils.js";

// Inject tippy's CSS + a small custom override for bibliography tooltips
(() => {
  const style = document.createElement("style");
  style.textContent =
    tippyCss +
    `
.tippy-box[data-theme~="librecite"] {
  background: #fff;
  color: #222;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.14);
  font-size: .875rem;
  line-height: 1.5;
  max-width: 420px !important;
  text-align: left;
}
.tippy-box[data-theme~="librecite"] .tippy-arrow { color: #d0d0d0; }
.tippy-box[data-theme~="librecite"] .bib-entry + .bib-entry {
  border-top: 1px solid #eee;
  margin-top: .4em;
  padding-top: .4em;
}
.tippy-box[data-theme~="librecite"] a { color: #0645ad; }

/* Numeric styles (IEEE, AMA, …) emit the label and the entry as two block
   divs; lay them out on one line with the entry text hanging-indented. */
.csl-flush { display: flex; gap: .5em; }
.references-list li.csl-flush { list-style: none; }
.csl-flush > .csl-left-margin { flex: none; min-width: 2.25em; }
.csl-flush > .csl-right-inline { flex: 1; min-width: 0; }
`;
  document.head.appendChild(style);
})();

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
    const pageInfo = await fetchJSON(
      `${API_BASE}/page/${pageID}/library/${LIBRARY}`,
    );
    const {
      projectID,
      lastUpdatedAt,
      format,
      displayLocation,
      backmatterPageID,
      backmatterReferenceList,
      scope,
      displayGroups,
    } = pageInfo;
    const { referenceItems, toc } = await getReferences(
      projectID,
      lastUpdatedAt,
    );

    let config = getFormatConfig(format);
    try {
      await loadCslStyle(config.cslStyle);
    } catch (err) {
      // Render with the built-in APA style rather than leaving raw markers.
      console.warn(`CSL style "${config.cslStyle}" failed to load; falling back to APA:`, err);
      config = getFormatConfig("APA");
    }

    const cslData = referenceItems.map(toCslJson);
    const engine = buildCiteprocEngine(cslData, config.cslStyle);

    // Numeric styles (IEEE, AMA, Vancouver) number citations in order of first
    // appearance, so the number rendered next to an in-text citation only matches
    // the bibliography if every page in a bibliography scope feeds citeproc the
    // identical key set.  Inject hidden markers to establish that shared scope:
    //
    //   endOfPage    → nothing to inject; the page's own visible \librecite
    //                  markers are exactly what belongs in its bibliography.
    //   endOfChapter → every ref on the pages of this page's group, in TOC
    //                  DFS order.
    //   backmatter   → every ref in the book.
    const scopeRefs = collectScopeRefs(
      displayLocation,
      toc,
      pageID,
      backmatterReferenceList,
      scope?.groups,
    );
    if (scopeRefs.length > 0) injectCitationMarkers(scopeRefs);

    const { allInstances, nodeMap } = collectAllCitationInstances(
      document.body,
    );
    if (allInstances.length === 0) return;

    const formattedCitations = processCitationsWithCiteproc(
      engine,
      allInstances,
    );
    const bibHtmlByKey = buildBibHtmlMap(engine);
    replaceAllCitationMarkers(
      nodeMap,
      formattedCitations,
      config,
      bibHtmlByKey,
    );
    const refUsageMap = buildRefUsageMap(toc);
    const render = (/** @type {HTMLElement} */ container) =>
      appendReferencesSection(engine, config, container, refUsageMap);

    switch (displayLocation) {
      case "endOfPage":
        render(getOrCreateReferenceOutput(pageID));
        break;
      case "endOfChapter":
        // A group's target page shows the bibliography once its container is
        // in the DOM; any other page in the group shows it only if it already
        // has its own container.
        if (isGroupTarget(pageID, displayGroups, scope?.groups)) {
          whenElementPresent(referenceOutputId(pageID), render);
        } else {
          const own = document.getElementById(referenceOutputId(pageID));
          if (own) render(own);
        }
        break;
      case "backmatter":
        if (pageID === String(backmatterPageID)) {
          render(getOrCreateReferenceOutput(pageID));
        }
        break;
    }
  } catch (err) {
    console.error("Failed to load citations:", err);
  }
});

// Expose utilities that other LibreTexts page scripts may call directly.
globalThis.termAnchorId = termAnchorId;
globalThis.escapeHtml = escapeHtml;

export { extractLibrary };
