// @ts-check
/**
 * @typedef {import('./types').CslJson}          CslJson
 * @typedef {import('./types').CitationInstance} CitationInstance
 * @typedef {import('./types').CiteprocEngine}   CiteprocEngine
 */

import CSL from "citeproc";
import enUsLocale from "./locales/locales-en-US.xml";

// ─── CSL / Citeproc ──────────────────────────────────────────────────────────

// CSL files in src/csl/ — keyed by the style name used in FORMAT_CONFIG.
// Fetched on demand from ../src/csl/ relative to the loader bundle, so a
// bundle on jsDelivr at …/biblizer@<hash>/dist/ gets styles from the same
// commit.
export const CSL_STYLE_FILES = {
  apa: "apa.csl",
  vancouver: "vancouver.csl",
  harvard1: "harvard1.csl",
  ieee: "ieee.csl",
  "american-medical-association": "american-medical-association.csl",
  "modern-language-association": "modern-language-association.csl",
  "chicago-author-date": "chicago-author-date.csl",
  "american-chemical-society": "american-chemical-society-template.csl",
};

// Style name → CSL XML, filled by loadCslStyle()
/** @type {Map<string, string>} */
export const loadedCslStyles = new Map();

/**
 * @param {string} styleName
 * @param {string} scriptUrl  URL of the loader bundle (dist/script*.js)
 */
export async function loadCslStyle(styleName, scriptUrl) {
  if (loadedCslStyles.has(styleName)) return;

  const file = CSL_STYLE_FILES[styleName];
  if (!file) {
    throw new Error(
      `CSL style "${styleName}" is unknown. Add it to src/csl/ and CSL_STYLE_FILES.`,
    );
  }
  const url = new URL(`../src/csl/${file}`, scriptUrl).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const xml = await response.text();

  loadedCslStyles.set(styleName, xml);
}

/**
 * Create a citeproc engine over `cslData` for a style already loaded with
 * loadCslStyle().  Only the en-US locale is bundled; other locales resolve
 * to an empty object and citeproc falls back to en-US.
 * @param {Array<{ id: string }>} cslData  CSL-JSON items (see toCslJson)
 * @param {string} styleName
 * @returns {CiteprocEngine}
 */
export function buildCiteprocEngine(cslData, styleName) {
  const xml = loadedCslStyles.get(styleName);
  if (!xml) throw new Error(`CSL style "${styleName}" has not been loaded`);

  const items = new Map(cslData.map((item) => [String(item.id), item]));
  const engine = new CSL.Engine(
    {
      retrieveItem(id) {
        const item = items.get(String(id));
        if (!item) throw new Error(`Cannot find entry with id '${id}'`);
        return item;
      },
      retrieveLocale: (lang) => (lang === "en-US" || lang === "en_US" ? enUsLocale : {}),
    },
    xml,
    "en-US",
    true,
  );
  engine.setOutputFormat("html");
  engine.opt.development_extensions.wrap_url_and_doi = false;
  return engine;
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
