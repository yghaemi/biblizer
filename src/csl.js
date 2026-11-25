// @ts-check
/**
 * @typedef {import('./types').CslJson}          CslJson
 * @typedef {import('./types').CitationInstance} CitationInstance
 * @typedef {import('./types').CiteprocEngine}   CiteprocEngine
 */

import { plugins } from "@citation-js/core";
import "@citation-js/plugin-csl";
import { CSL_FALLBACK_SCRIPT_URL } from "./config.js";

// ─── CSL / Citeproc ──────────────────────────────────────────────────────────

// URL this bundle was loaded from.  Must be read now, while the <script> is
// executing — document.currentScript is null once DOMContentLoaded fires.
const SCRIPT_URL =
  /** @type {HTMLScriptElement|null} */ (document.currentScript)?.src ||
  CSL_FALLBACK_SCRIPT_URL;

// CSL files in src/csl/ — keyed by the style name used in FORMAT_CONFIG.
// Fetched on demand from ../src/csl/ relative to the bundle, so a bundle on
// jsDelivr at …/biblizer@<hash>/dist/ gets styles from the same commit.
export const CSL_STYLE_FILES = {
  ieee: "ieee.csl",
  "american-medical-association": "american-medical-association.csl",
  "modern-language-association": "modern-language-association.csl",
  "chicago-author-date": "chicago-author-date.csl",
  "american-chemical-society": "american-chemical-society-template.csl",
};

// Styles shipped inside @citation-js/plugin-csl — already registered
export const loadedCslStyles = new Set(["apa", "vancouver", "harvard1"]);

/** @param {string} styleName */
export async function loadCslStyle(styleName) {
  if (loadedCslStyles.has(styleName)) return;

  const file = CSL_STYLE_FILES[styleName];
  if (!file) {
    throw new Error(
      `CSL style "${styleName}" is unknown. Add it to src/csl/ and CSL_STYLE_FILES.`,
    );
  }
  const url = new URL(`../src/csl/${file}`, SCRIPT_URL).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const xml = await response.text();

  plugins.config.get("@csl").styles.add(styleName, xml);
  loadedCslStyles.add(styleName);
}

export function buildCiteprocEngine(cslData, styleName) {
  return plugins.config.get("@csl").engine(cslData, styleName, "en-US", "html");
}

// Process all citation instances through citeproc in document order.
// Calling processCitationCluster sequentially gives citeproc the context it
// needs for correct numbering and author-date disambiguation (e.g. Smith 2020a
// vs Smith 2020b).
export function processCitationsWithCiteproc(engine, allInstances) {
  const uniqueIds = [...new Set(allInstances.flatMap((inst) => inst.keys))];
  engine.updateItems(uniqueIds);

  const citationTexts = new Array(allInstances.length).fill("?");
  const citationsPre = [];

  for (let i = 0; i < allInstances.length; i++) {
    const citationId = `cite-${i}`;
    const citation = {
      citationID: citationId,
      citationItems: allInstances[i].keys.map((id) => ({ id })),
      properties: { noteIndex: 0 },
    };

    const [, updates = []] = engine.processCitationCluster(
      citation,
      citationsPre,
      [],
    );

    // updates: [[position, formattedText, citationID], ...]
    // Earlier citations may be re-emitted if disambiguation changes them.
    for (const update of updates) {
      const [, text, id] = Array.isArray(update) ? update : [];
      if (typeof id === "string") {
        const idx = parseInt(id.replace("cite-", ""), 10);
        if (idx >= 0 && idx < allInstances.length) {
          citationTexts[idx] = text ?? "?";
        }
      }
    }

    citationsPre.push([citationId, 0]);
  }

  return citationTexts;
}

// Builds a Map from citation key → formatted bibliography HTML string.
// Used to populate tippy tooltips on in-text citation elements.
export function buildBibHtmlMap(engine) {
  const [params, entries] = engine.makeBibliography();
  const map = new Map();
  (params.entry_ids ?? []).forEach((ids, i) => {
    const key = ids?.[0];
    if (!key) return;
    const temp = document.createElement("div");
    temp.innerHTML = entries[i] ?? "";
    const cslEntry = temp.querySelector(".csl-entry");
    map.set(key, (cslEntry ? cslEntry.innerHTML : (entries[i] ?? "")).trim());
  });
  return map;
}
