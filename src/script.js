// @ts-check
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

import { plugins } from "@citation-js/core";
import "@citation-js/plugin-csl";
import cslIeee from "./csl/ieee.csl";
import cslAma from "./csl/american-medical-association.csl";
import cslMla from "./csl/modern-language-association.csl";
import cslChicago from "./csl/chicago-author-date.csl";
import tippy from "tippy.js";
import tippyCss from "tippy.js/dist/tippy.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = `${process.env.API_HOST}/api/v1/reference`;
const CACHE_PREFIX = "libretexts-references:";

const DEKI_TOKEN_URL = "https://cdn.libretexts.net/authenBrowser.json";

const LIBRARY = extractLibrary(window.location.hostname);

// CSL XML bundled at build time — keyed by the style name used in FORMAT_CONFIG
const BUNDLED_CSL_STYLES = {
  ieee: cslIeee,
  "american-medical-association": cslAma,
  "modern-language-association": cslMla,
  "chicago-author-date": cslChicago,
};

// Styles shipped inside @citation-js/plugin-csl — already registered
const loadedCslStyles = new Set(["apa", "vancouver", "harvard1"]);

// ─── Format config ────────────────────────────────────────────────────────────
// cslStyle   – name passed to citeproc engine
// heading    – h2 text for the references section
// listType   – ol (numbered) or ul (author-date)
// superscript – wrap in-text citation in <sup> when citeproc hasn't already done so

const FORMAT_CONFIG = {
  IEEE: {
    cslStyle: "ieee",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  Vancouver: {
    cslStyle: "vancouver",
    heading: "References",
    listType: "ul",
    superscript: false,
  },
  AMA: {
    cslStyle: "american-medical-association",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  CSM: {
    cslStyle: "ieee",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  ASN: {
    cslStyle: "american-medical-association",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  ANSI: {
    cslStyle: "ieee",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  APA: {
    cslStyle: "apa",
    heading: "References",
    listType: "ul",
    superscript: false,
  },
  MLA: {
    cslStyle: "modern-language-association",
    heading: "Works Cited",
    listType: "ul",
    superscript: false,
  },
  Chicago: {
    cslStyle: "chicago-author-date",
    heading: "References",
    listType: "ul",
    superscript: false,
  },
  Harvard: {
    cslStyle: "harvard1",
    heading: "Reference List",
    listType: "ul",
    superscript: false,
  },
};

// BibTeX entry types → CSL types
const ENTRY_TYPE_MAP = {
  article: "article-journal",
  incollection: "chapter",
  book: "book",
  inproceedings: "paper-conference",
  proceedings: "book",
  techreport: "report",
  thesis: "thesis",
  mastersthesis: "thesis",
  phdthesis: "thesis",
  misc: "document",
  online: "webpage",
  electronic: "webpage",
  unpublished: "manuscript",
};

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
  // Resolve the page actually in the address bar via the Deki API, so the id
  // is right even when this page has been transcluded into another.
  /** @type {string} */
  let pageID;
  try {
    pageID = await fetchCurrentPageId(LIBRARY);
  } catch (err) {
    console.error("pageID not found:", err);
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

    const config = getFormatConfig(format);
    loadCslStyle(config.cslStyle);

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
        // Only a group's target page shows the bibliography, once its
        // container is in the DOM.
        if (isGroupTarget(pageID, displayGroups, scope?.groups)) {
          whenElementPresent(referenceOutputId(pageID), render);
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

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Look up the current page's id through MindTouch's Deki API, keyed off
 * window.location.
 * @param {string} library
 * @returns {Promise<string>}
 */
async function fetchCurrentPageId(library) {
  const tokenResponse = await fetch(DEKI_TOKEN_URL);
  if (!tokenResponse.ok) throw new Error(`HTTP ${tokenResponse.status} for ${DEKI_TOKEN_URL}`);
  /** @type {Record<string, string>} */
  const tokens = await tokenResponse.json();
  const token = tokens[library];
  if (!token) throw new Error(`No x-deki-token for library "${library}"`);

  // Deki's page-by-path lookup expects the path (no leading slash, no domain)
  // double URL-encoded as a single path segment.
  const path = window.location.pathname.replace(/^\//, "");
  const encodedPath = encodeURIComponent(encodeURIComponent(path));
  const url = `https://${library}.libretexts.org/@api/deki/pages/=${encodedPath}?dream.out.format=json`;

  const response = await fetch(url, {
    headers: { "x-deki-token": token, "x-requested-with": "XMLHttpRequest" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const data = await response.json();
  if (!data?.["@id"]) throw new Error("Deki pages response missing @id");
  return String(data["@id"]);
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const json = await response.json();
  if (json.err) throw new Error(`API error for ${url}`);
  return json.data;
}

function getCacheKey(projectID) {
  return `${CACHE_PREFIX}${projectID}`;
}

function getCachedReferences(projectID) {
  const raw = localStorage.getItem(getCacheKey(projectID));
  return raw ? JSON.parse(raw) : null;
}

function setCachedReferences(
  projectID,
  lastUpdatedAt,
  { referenceItems, toc },
) {
  localStorage.setItem(
    getCacheKey(projectID),
    JSON.stringify({ lastUpdatedAt, referenceItems, toc }),
  );
}

function isCacheValid(cached, lastUpdatedAt) {
  return !!(
    cached?.lastUpdatedAt &&
    cached.referenceItems &&
    new Date(cached.lastUpdatedAt) >= new Date(lastUpdatedAt)
  );
}

async function getReferences(projectID, lastUpdatedAt) {
  const cached = getCachedReferences(projectID);
  if (isCacheValid(cached, lastUpdatedAt)) {
    return { referenceItems: cached.referenceItems, toc: cached.toc };
  }
  const data = await fetchJSON(`${API_BASE}/projects/${projectID}`);
  setCachedReferences(projectID, lastUpdatedAt, {
    referenceItems: data.referenceItems,
    toc: data.toc,
  });
  return { referenceItems: data.referenceItems, toc: data.toc };
}

// ─── CSL / Citeproc ──────────────────────────────────────────────────────────

function loadCslStyle(styleName) {
  if (loadedCslStyles.has(styleName)) return;

  const xml = BUNDLED_CSL_STYLES[styleName];
  if (!xml) {
    throw new Error(
      `CSL style "${styleName}" is not bundled. Add it to src/csl/.`,
    );
  }
  plugins.config.get("@csl").styles.add(styleName, xml);
  loadedCslStyles.add(styleName);
}

function buildCiteprocEngine(cslData, styleName) {
  return plugins.config.get("@csl").engine(cslData, styleName, "en-US", "html");
}

// Process all citation instances through citeproc in document order.
// Calling processCitationCluster sequentially gives citeproc the context it
// needs for correct numbering and author-date disambiguation (e.g. Smith 2020a
// vs Smith 2020b).
function processCitationsWithCiteproc(engine, allInstances) {
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
function buildBibHtmlMap(engine) {
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

// ─── Citation Collection ─────────────────────────────────────────────────────

// Returns every \librecite{...} occurrence in document order (duplicates
// included), grouped by text node for efficient DOM replacement.
function collectAllCitationInstances(root) {
  const allInstances = []; // flat list – indices used as citeproc citation IDs
  const nodeMap = new Map(); // textNode → [{keys, matchIndex, matchLen, instanceIndex}]

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent;
    if (!text.includes("\\librecite{")) continue;

    const nodeInstances = [];
    nodeMap.set(node, nodeInstances);

    for (const match of text.matchAll(/\\librecite\{([^}]+)\}/g)) {
      const instanceIndex = allInstances.length;
      const keys = parseCitationKeys(match[1]);
      allInstances.push({ keys });
      nodeInstances.push({
        keys,
        matchIndex: match.index,
        matchLen: match[0].length,
        instanceIndex,
      });
    }
  }

  return { allInstances, nodeMap };
}

function parseCitationKeys(content) {
  return content
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// ─── TOC Helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the set of reference keys that make up this page's bibliography
 * scope.  Returns `[]` for `endOfPage`, where the page's own visible markers
 * already are the scope and nothing needs injecting.
 *
 * @param {string} displayLocation  'endOfPage' | 'endOfChapter' | 'backmatter'
 * @param {TocNode|null|undefined} toc
 * @param {string} pageID
 * @param {string[]|null|undefined} backmatterReferenceList
 * @param {ScopeGroup[]|null|undefined} groups
 * @returns {string[]}
 */
function collectScopeRefs(
  displayLocation,
  toc,
  pageID,
  backmatterReferenceList,
  groups,
) {
  if (displayLocation === "endOfChapter") {
    const group = groups?.find((g) => g.pageIds.map(String).includes(pageID));
    // Without saved groups, fall back to the page's whole chapter subtree.
    return group ? collectGroupRefs(toc, group.pageIds) : collectChapterRefs(toc, pageID);
  }
  if (displayLocation === "backmatter") {
    // The API normally supplies the book-wide list; fall back to walking the
    // TOC so a missing list doesn't silently produce an empty bibliography.
    return backmatterReferenceList?.length
      ? [...backmatterReferenceList]
      : collectAllTocRefs(toc);
  }
  return [];
}

/**
 * BFS-collect every ref key in the chapter subtree that contains `pageId`.
 *
 * The subtree root is the ancestor that is a **direct child of the book root**
 * — the chapter.  Because every page inside a chapter resolves to that same
 * root, this returns an identical key set (in identical BFS order) no matter
 * which page of the chapter is asking, which is what keeps numeric citation
 * numbers aligned with the chapter bibliography.
 *
 * A page that is itself a direct book child is its own chapter root, so it
 * collects only its own refs and those of its descendants.
 *
 * Example: pages 9214, 9242, 9878 and 9888 all resolve to chapter root 9214
 * and each collect 9214.refs + 9242.refs + 9243.refs + 9878.refs + 9888.refs…
 *
 * @param {TocNode|null|undefined} toc
 * @param {string} pageId
 * @returns {string[]}
 */
function collectChapterRefs(toc, pageId) {
  if (!toc) return [];

  // Single DFS to build nodeMap (id → node) and parentMap (id → parent).
  /** @type {Map<string, TocNode>} */
  const nodeMap = new Map();
  /** @type {Map<string, TocNode>} */
  const parentMap = new Map();

  (function index(node, parent) {
    nodeMap.set(String(node.id), node);
    if (parent) parentMap.set(String(node.id), parent);
    for (const child of node.children ?? []) index(child, node);
  })(toc, null);

  let node = nodeMap.get(String(pageId));
  if (!node) return [];

  // Walk up until the parent is the book root (a node with no parent itself).
  while (true) {
    const parent = parentMap.get(String(node.id));
    if (!parent) return []; // node is the book root — no enclosing chapter
    if (!parentMap.has(String(parent.id))) break; // parent is the book root
    node = parent;
  }

  return subtreeRefs(node);
}

/**
 * DFS (pre-order, i.e. reading order) over the TOC collecting the ref keys of
 * the pages in a group, first-seen order.  Every page of the group gets the
 * same key order, so numeric citation numbers match the group bibliography.
 *
 * @param {TocNode|null|undefined} toc
 * @param {string[]} pageIds
 * @returns {string[]}
 */
function collectGroupRefs(toc, pageIds) {
  if (!toc) return [];
  const members = new Set(pageIds.map(String));
  /** @type {Set<string>} */
  const refs = new Set();
  (function visit(node) {
    if (members.has(String(node.id))) {
      for (const ref of node.refs ?? []) refs.add(ref);
    }
    for (const child of node.children ?? []) visit(child);
  })(toc);
  return [...refs];
}

/**
 * BFS-collect every ref key in the whole book, used for backmatter scope.
 *
 * @param {TocNode|null|undefined} toc
 * @returns {string[]}
 */
function collectAllTocRefs(toc) {
  return toc ? subtreeRefs(toc) : [];
}

/**
 * BFS over a TOC subtree, accumulating ref keys in first-seen order.
 *
 * @param {TocNode} root
 * @returns {string[]}
 */
function subtreeRefs(root) {
  const refs = new Set();
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    for (const ref of node.refs ?? []) refs.add(ref);
    for (const child of node.children ?? []) queue.push(child);
  }
  return [...refs];
}

/**
 * Traverse the full TOC tree and build a reverse map:
 *   citationKey → [{id, title}] of pages that cite it
 *
 * Nodes whose `refs` array is non-empty and whose `title` is set contribute
 * to the map.  Duplicate page IDs for the same key are deduplicated.
 *
 * @param {TocNode|null|undefined} toc
 * @returns {Map<string, {id: string, title: string}[]>}
 */
function buildRefUsageMap(toc) {
  /** @type {Map<string, Map<string, string>>} key → (pageId → pageTitle) */
  const map = new Map();
  if (!toc) return new Map();

  const queue = [toc];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node.id && node.title && Array.isArray(node.refs)) {
      for (const key of node.refs) {
        if (!map.has(key)) map.set(key, new Map());
        map.get(key).set(String(node.id), node.title);
      }
    }
    for (const child of node.children ?? []) queue.push(child);
  }

  // Convert inner Maps → sorted arrays of {id, title}.
  /** @type {Map<string, {id: string, title: string}[]>} */
  const result = new Map();
  for (const [key, pages] of map) {
    result.set(key, [...pages.entries()].map(([id, title]) => ({ id, title })));
  }
  return result;
}

// ─── DOM Manipulation ────────────────────────────────────────────────────────

// Inserts a hidden <div> as the first child of the first
// <section class="mt-content-container">, containing one \librecite{key}
// text node per item in the list. This makes every scope reference visible to
// collectAllCitationInstances without appearing on screen.
//
// The block goes first so citeproc assigns numbers in the scope's order before
// it reaches any visible citation, giving every page in the scope the same
// key → number mapping.
function injectCitationMarkers(referenceList) {
  const container = document.querySelector("section.mt-content-container");
  if (!container) return;

  const block = document.createElement("div");
  block.style.display = "none";
  block.setAttribute("aria-hidden", "true");

  for (const key of referenceList) {
    const span = document.createElement("span");
    span.textContent = `\\librecite{${key}}`;
    block.appendChild(span);
  }

  container.insertBefore(block, container.firstChild);
}

function replaceAllCitationMarkers(
  nodeMap,
  formattedCitations,
  config,
  bibHtmlByKey,
) {
  for (const [textNode, instances] of nodeMap) {
    replaceNodeCitations(
      textNode,
      instances,
      formattedCitations,
      config,
      bibHtmlByKey,
    );
  }
}

function replaceNodeCitations(
  textNode,
  instances,
  formattedCitations,
  config,
  bibHtmlByKey,
) {
  const text = textNode.textContent;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const { keys, matchIndex, matchLen, instanceIndex } of instances) {
    if (matchIndex > lastIndex) {
      fragment.appendChild(
        document.createTextNode(text.slice(lastIndex, matchIndex)),
      );
    }

    const formattedHtml = formattedCitations[instanceIndex] ?? "?";

    // Some CSL styles (e.g. AMA) emit their own <sup> via vertical-align="sup".
    // Only add a <sup> wrapper when the format wants superscript AND citeproc
    // hasn't already produced one (avoids double-nesting).
    const hasSup = formattedHtml.includes("<sup");
    const tag = config.superscript && !hasSup ? "sup" : "span";
    const elem = document.createElement(tag);
    elem.className = "librecite";
    elem.dataset.citationKeys = keys.join(",");
    elem.innerHTML = formattedHtml;
    elem.setAttribute("tabindex", "0");
    elem.setAttribute("role", "button");

    const scrollToRef = () => {
      for (const key of keys) {
        const target = document.getElementById(`ref-${key}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth" });
          break;
        }
      }
    };

    elem.addEventListener("click", scrollToRef);

    // Build tooltip content from bibliography entries for each cited key
    const tooltipHtml = keys
      .map((k) => bibHtmlByKey?.get(k))
      .filter(Boolean)
      .map((html) => {
        const flush = html.includes("csl-left-margin") ? " csl-flush" : "";
        return `<div class="bib-entry${flush}">${html}</div>`;
      })
      .join("");

    // Create the tippy instance in manual+mouseenter mode so keyboard users
    // control visibility explicitly (Space to show, Escape to hide) while
    // mouse users still get the hover tooltip.
    const instance = tooltipHtml
      ? tippy(elem, {
          content: tooltipHtml,
          allowHTML: true,
          theme: "librecite",
          placement: "top",
          maxWidth: 420,
          interactive: true, // lets users click links inside the tooltip
          appendTo: document.body, // avoids overflow-hidden clipping
          trigger: "mouseenter", // mouse hover only; keyboard handled below
          delay: [500, 0],

        })
      : null;

    elem.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        scrollToRef();
      } else if (e.key === " ") {
        // Space toggles the tooltip
        e.preventDefault();
        if (instance) {
          instance.state.isVisible ? instance.hide() : instance.show();
        }
      } else if (e.key === "Escape") {
        // Escape always dismisses
        if (instance) instance.hide();
      }
    });

    fragment.appendChild(elem);
    lastIndex = matchIndex + matchLen;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  textNode.parentNode.replaceChild(fragment, textNode);
}

// ─── Bibliography containers ────────────────────────────────────────────────
// A page's bibliography renders into
//   <div class="reference-output" id="reference-output-{pageID}">

/** @param {string} pageID */
function referenceOutputId(pageID) {
  return `reference-output-${pageID}`;
}

/**
 * Remove every .reference-output that belongs to another page (carried in by
 * transclusion).
 * @param {string} pageID
 */
function removeForeignReferenceOutputs(pageID) {
  const ownId = referenceOutputId(pageID);
  for (const el of document.querySelectorAll(".reference-output")) {
    if (el.id !== ownId) el.remove();
  }
}

/**
 * This page's container, or a new one appended as the last child of
 * `#elm-main-content > section` when the page doesn't provide one.
 * @param {string} pageID
 * @returns {HTMLElement}
 */
function getOrCreateReferenceOutput(pageID) {
  const id = referenceOutputId(pageID);
  const existing = document.getElementById(id);
  if (existing) return existing;

  const container = document.createElement("div");
  container.className = "reference-output";
  container.id = id;
  const parent =
    document.querySelector("#elm-main-content > section") ??
    document.querySelector("section.mt-content-container") ??
    document.body;
  parent.appendChild(container);
  return container;
}

/**
 * Whether this page is the target of a bibliography group.  `displayGroups`
 * is the API's list of groups this page renders; `groups` is the full scope
 * as a fallback.
 * @param {string} pageID
 * @param {ScopeGroup[]|null|undefined} displayGroups
 * @param {ScopeGroup[]|null|undefined} groups
 * @returns {boolean}
 */
function isGroupTarget(pageID, displayGroups, groups) {
  return [...(displayGroups ?? []), ...(groups ?? [])].some(
    (g) => String(g.targetPageId) === pageID,
  );
}

/**
 * Call `callback` with the element once it is in the DOM — now if it already
 * is, otherwise as soon as it is added.
 * @param {string} id
 * @param {(el: HTMLElement) => void} callback
 */
function whenElementPresent(id, callback) {
  const existing = document.getElementById(id);
  if (existing) {
    callback(existing);
    return;
  }
  const observer = new MutationObserver(() => {
    const el = document.getElementById(id);
    if (!el) return;
    observer.disconnect();
    callback(el);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * @param {CiteprocEngine} engine
 * @param {FormatConfig} config
 * @param {HTMLElement} container  where the bibliography is rendered
 * @param {Map<string, {id: string, title: string}[]>} refUsageMap  citationKey → pages that cite it
 */
function appendReferencesSection(engine, config, container, refUsageMap) {
  const [params, bibEntries] = engine.makeBibliography();
  if (!bibEntries?.length) return;

  // params.entry_ids is [[id1], [id2], ...] – one inner array per entry
  const entryIds = params.entry_ids ?? [];

  // Heading
  const heading = document.createElement("h2");
  heading.textContent = config.heading;
  container.appendChild(heading);


  const list = document.createElement(config.listType);
  list.className = "references-list";

  bibEntries.forEach((entryHtml, i) => {
    const key = entryIds[i]?.[0];
    const li = document.createElement("li");
    if (key) li.id = `ref-${key}`;

    // Citeproc wraps each entry in <div class="csl-entry">; unwrap for clean
    // <li> content that matches the existing page CSS expectations.
    const temp = document.createElement("div");
    temp.innerHTML = entryHtml;
    const cslEntry = temp.querySelector(".csl-entry");
    li.innerHTML = cslEntry ? cslEntry.innerHTML : entryHtml;
    if (li.querySelector(":scope > .csl-left-margin")) li.classList.add("csl-flush");

    // Tooltip: list the TOC page titles (with links) that cite this reference.
    if (key && refUsageMap) {
      const pages = refUsageMap.get(key);
      if (pages && pages.length > 0) {
        const items = pages
          .map(({ id, title }) => {
            const href = `https://${LIBRARY}.libretexts.org/@go/page/${id}`;
            return `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></li>`;
          })
          .join("");
        const tooltipHtml =
          `<div class="librecite-usage-tooltip">` +
          `<strong>Cited in:</strong>` +
          `<ul>${items}</ul>` +
          `</div>`;

        li.setAttribute("tabindex", "0");
        li.setAttribute("role", "button");

        const instance = tippy(li, {
          content: tooltipHtml,
          allowHTML: true,
          theme: "librecite",
          placement: "top-start",
          followCursor: "initial",
          maxWidth: 340,
          interactive: true,
          appendTo: document.body,
          trigger: "mouseenter focus",
          delay: [1000, 0],
        });

        li.addEventListener("keydown", (e) => {
          if (e.key === " ") {
            e.preventDefault();
            instance.state.isVisible ? instance.hide() : instance.show();
          } else if (e.key === "Escape") {
            instance.hide();
          }
        });
      }
    }

    list.appendChild(li);
  });

  container.appendChild(list);
}

// ─── Data Conversion ─────────────────────────────────────────────────────────

function toCslJson(item) {
  return {
    id: item.citationKey,
    type: ENTRY_TYPE_MAP[item.entryType?.toLowerCase()] ?? "document",
    title: item.title ?? "Untitled",
    author: parseAuthorToCsl(item.author),
    issued: item.year ? { "date-parts": [[Number(item.year)]] } : undefined,
    "container-title": item.journal ?? item.booktitle ?? undefined,
    volume: item.volume ?? undefined,
    issue: item.number ?? undefined,
    page: item.pages?.replace(/--/g, "-") ?? undefined,
    URL: item.url ?? undefined,
    publisher: item.publisher ?? undefined,
    note: item.note ?? undefined,
  };
}

// Parses a BibTeX-style author string ("Last, First and Last2, First2") into
// the CSL-JSON author array ([{family, given}, ...]).
function parseAuthorToCsl(authorString) {
  if (!authorString) return [];

  return authorString
    .split(/\s+and\s+/i)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      if (name.includes(",")) {
        const commaIdx = name.indexOf(",");
        return {
          family: name.slice(0, commaIdx).trim(),
          given: name.slice(commaIdx + 1).trim(),
        };
      }
      const parts = name.split(/\s+/);
      return {
        family: parts[parts.length - 1],
        given: parts.slice(0, -1).join(" "),
      };
    });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function extractLibrary(hostname) {
  if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) {
    return "dev";
  }
  const parts = hostname.split(".");
  return parts[0]?.toLowerCase() ?? "dev";
}

function getFormatConfig(format) {
  return FORMAT_CONFIG[format] ?? FORMAT_CONFIG.IEEE;
}

// Stable anchor id for a term. Must match termAnchorId() in glossarizer.js.
function termAnchorId(term) {
  return (
    "gt-anchor-" +
    String(term)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Expose utilities that other LibreTexts page scripts may call directly.
globalThis.termAnchorId = termAnchorId;
globalThis.escapeHtml = escapeHtml;
