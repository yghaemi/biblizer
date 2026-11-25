// @ts-check
// Citation engine: everything that needs citeproc or tippy.  Built as a
// separate ES module (dist/engine*.js) and imported by the loader
// (src/script.js) only on pages that have citations to render.
/**
 * @typedef {import('./types').PageInfo}       PageInfo
 * @typedef {import('./types').ReferenceItem}  ReferenceItem
 * @typedef {import('./types').TocNode}        TocNode
 */

import tippyCss from "tippy.js/dist/tippy.css";
import { getFormatConfig } from "./config.js";
import { buildBibHtmlMap, buildCiteprocEngine, loadCslStyle, processCitationsWithCiteproc } from "./csl.js";
import { toCslJson } from "./convert.js";
import { buildRefUsageMap } from "./toc.js";
import { collectAllCitationInstances, injectCitationMarkers, replaceAllCitationMarkers } from "./citations.js";
import { appendReferencesSection } from "./bibliography.js";
import {
  getOrCreateReferenceOutput,
  isGroupTarget,
  referenceOutputId,
  whenElementPresent,
} from "./containers.js";

// ─── Styles ──────────────────────────────────────────────────────────────────

// Inject tippy's CSS + a small custom override for bibliography tooltips
function injectTooltipStyles() {
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
}

// ─── Render ──────────────────────────────────────────────────────────────────

/**
 * Format every \librecite marker on the page and render the bibliography.
 *
 * @param {object} ctx
 * @param {string} ctx.pageID
 * @param {PageInfo} ctx.pageInfo
 * @param {ReferenceItem[]} ctx.referenceItems
 * @param {TocNode} ctx.toc
 * @param {string[]} ctx.scopeRefs  hidden scope keys to inject (see collectScopeRefs)
 * @param {string} ctx.scriptUrl    loader URL, base for ../src/csl/
 */
export async function renderCitations({ pageID, pageInfo, referenceItems, toc, scopeRefs, scriptUrl }) {
  const { format, displayLocation, backmatterPageID, scope, displayGroups } = pageInfo;

  let config = getFormatConfig(format);
  try {
    await loadCslStyle(config.cslStyle, scriptUrl);
  } catch (err) {
    // Try APA rather than leaving raw markers; if that fails too, the caller
    // reports it.
    console.warn(`CSL style "${config.cslStyle}" failed to load; falling back to APA:`, err);
    config = getFormatConfig("APA");
    await loadCslStyle(config.cslStyle, scriptUrl);
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
  if (scopeRefs.length > 0) injectCitationMarkers(scopeRefs);

  const { allInstances, nodeMap } = collectAllCitationInstances(
    document.body,
  );
  if (allInstances.length === 0) return;

  injectTooltipStyles();

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
}
