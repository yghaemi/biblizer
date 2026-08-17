import { plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import cslIeee from './csl/ieee.csl';
import cslAma from './csl/american-medical-association.csl';
import cslMla from './csl/modern-language-association.csl';
import cslChicago from './csl/chicago-author-date.csl';
import tippy from 'tippy.js';
import tippyCss from 'tippy.js/dist/tippy.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = `${process.env.API_HOST}/api/v1/reference`;
const CACHE_PREFIX = "libretexts-references:";

const LIBRARY = extractLibrary(window.location.hostname);

// CSL XML bundled at build time — keyed by the style name used in FORMAT_CONFIG
const BUNDLED_CSL_STYLES = {
  'ieee':                         cslIeee,
  'american-medical-association': cslAma,
  'modern-language-association':  cslMla,
  'chicago-author-date':          cslChicago,
};

// Styles shipped inside @citation-js/plugin-csl — already registered
const loadedCslStyles = new Set(['apa', 'vancouver', 'harvard1']);

// ─── Format config ────────────────────────────────────────────────────────────
// cslStyle   – name passed to citeproc engine
// heading    – h2 text for the references section
// listType   – ol (numbered) or ul (author-date)
// superscript – wrap in-text citation in <sup> when citeproc hasn't already done so

const FORMAT_CONFIG = {
  IEEE:      { cslStyle: 'ieee',                         heading: 'References',     listType: 'ul', superscript: true  },
  Vancouver: { cslStyle: 'vancouver',                    heading: 'References',     listType: 'ul', superscript: false },
  AMA:       { cslStyle: 'american-medical-association', heading: 'References',     listType: 'ul', superscript: true  },
  CSM:       { cslStyle: 'ieee',                         heading: 'References',     listType: 'ul', superscript: true  },
  ASN:       { cslStyle: 'american-medical-association', heading: 'References',     listType: 'ul', superscript: true  },
  ANSI:      { cslStyle: 'ieee',                         heading: 'References',     listType: 'ul', superscript: true  },
  APA:       { cslStyle: 'apa',                          heading: 'References',     listType: 'ul', superscript: false },
  MLA:       { cslStyle: 'modern-language-association',  heading: 'Works Cited',    listType: 'ul', superscript: false },
  Chicago:   { cslStyle: 'chicago-author-date',          heading: 'References',     listType: 'ul', superscript: false },
  Harvard:   { cslStyle: 'harvard1',                     heading: 'Reference List', listType: 'ul', superscript: false },
};

// BibTeX entry types → CSL types
const ENTRY_TYPE_MAP = {
  article:       'article-journal',
  incollection:  'chapter',
  book:          'book',
  inproceedings: 'paper-conference',
  proceedings:   'book',
  techreport:    'report',
  thesis:        'thesis',
  mastersthesis: 'thesis',
  phdthesis:     'thesis',
  misc:          'document',
  online:        'webpage',
  electronic:    'webpage',
  unpublished:   'manuscript',
};

// Inject tippy's CSS + a small custom override for bibliography tooltips
;(() => {
  const style = document.createElement('style');
  style.textContent = tippyCss + `
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
`;
  document.head.appendChild(style);
})();

// ─── Main ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const pageID = document.getElementById("pageID")?.value;
  if (!pageID) {
    console.error("pageID not found");
    return;
  }

  try {
    const pageInfo = await fetchJSON(`${API_BASE}/page/${pageID}/library/${LIBRARY}`);
    const { projectID, lastUpdatedAt, format, displayLocation, pageTitle, backmatterPageID, backmatterReferenceList } = pageInfo;
    const referenceItems = await getReferences(projectID, lastUpdatedAt);

    const config = getFormatConfig(format);
    loadCslStyle(config.cslStyle);

    const cslData = referenceItems.map(toCslJson);
    const engine = buildCiteprocEngine(cslData, config.cslStyle);

    // When displayLocation is 'backmatter', inject hidden \librecite{key} markers
    // on every page so all backmatter references are collected and numbered
    // consistently, even if they aren't explicitly cited in the visible text.
    if (displayLocation === 'backmatter' && Array.isArray(backmatterReferenceList) && backmatterReferenceList.length > 0) {
      injectBackmatterMarkers(backmatterReferenceList);
    }

    const { allInstances, nodeMap } = collectAllCitationInstances(document.body);
    if (allInstances.length === 0) return;

    const formattedCitations = processCitationsWithCiteproc(engine, allInstances);
    const bibHtmlByKey = buildBibHtmlMap(engine);
    replaceAllCitationMarkers(nodeMap, formattedCitations, config, bibHtmlByKey);
    appendReferencesSection(engine, config, displayLocation, pageID, backmatterPageID);
  } catch (err) {
    console.error("Failed to load citations:", err);
  }
});

// ─── API ─────────────────────────────────────────────────────────────────────

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

function setCachedReferences(projectID, lastUpdatedAt, referenceItems) {
  localStorage.setItem(
    getCacheKey(projectID),
    JSON.stringify({ lastUpdatedAt, referenceItems }),
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
  if (isCacheValid(cached, lastUpdatedAt)) return cached.referenceItems;
  const data = await fetchJSON(`${API_BASE}/projects/${projectID}`);
  setCachedReferences(projectID, lastUpdatedAt, data.referenceItems);
  return data.referenceItems;
}

// ─── CSL / Citeproc ──────────────────────────────────────────────────────────

function loadCslStyle(styleName) {
  if (loadedCslStyles.has(styleName)) return;

  const xml = BUNDLED_CSL_STYLES[styleName];
  if (!xml) {
    throw new Error(`CSL style "${styleName}" is not bundled. Add it to src/csl/.`);
  }
  plugins.config.get('@csl').styles.add(styleName, xml);
  loadedCslStyles.add(styleName);
}

function buildCiteprocEngine(cslData, styleName) {
  return plugins.config.get('@csl').engine(cslData, styleName, 'en-US', 'html');
}

// Process all citation instances through citeproc in document order.
// Calling processCitationCluster sequentially gives citeproc the context it
// needs for correct numbering and author-date disambiguation (e.g. Smith 2020a
// vs Smith 2020b).
function processCitationsWithCiteproc(engine, allInstances) {
  const uniqueIds = [...new Set(allInstances.flatMap(inst => inst.keys))];
  engine.updateItems(uniqueIds);

  const citationTexts = new Array(allInstances.length).fill('?');
  const citationsPre = [];

  for (let i = 0; i < allInstances.length; i++) {
    const citationId = `cite-${i}`;
    const citation = {
      citationID: citationId,
      citationItems: allInstances[i].keys.map(id => ({ id })),
      properties: { noteIndex: 0 },
    };

    const [, updates = []] = engine.processCitationCluster(citation, citationsPre, []);

    // updates: [[position, formattedText, citationID], ...]
    // Earlier citations may be re-emitted if disambiguation changes them.
    for (const update of updates) {
      const [, text, id] = Array.isArray(update) ? update : [];
      if (typeof id === 'string') {
        const idx = parseInt(id.replace('cite-', ''), 10);
        if (idx >= 0 && idx < allInstances.length) {
          citationTexts[idx] = text ?? '?';
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
    const temp = document.createElement('div');
    temp.innerHTML = entries[i] ?? '';
    const cslEntry = temp.querySelector('.csl-entry');
    map.set(key, (cslEntry ? cslEntry.innerHTML : entries[i] ?? '').trim());
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
    if (!text.includes('\\librecite{')) continue;

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
  return content.split(",").map(k => k.trim()).filter(Boolean);
}

// ─── DOM Manipulation ────────────────────────────────────────────────────────

// Inserts a hidden <div> as the first child of the first
// <section class="mt-content-container">, containing one \librecite{key}
// text node per item in the list. This makes every backmatter reference
// visible to collectAllCitationInstances without appearing on screen.
function injectBackmatterMarkers(referenceList) {
  const container = document.querySelector('section.mt-content-container');
  if (!container) return;

  const block = document.createElement('div');
  block.style.display = 'none';
  block.setAttribute('aria-hidden', 'true');

  for (const key of referenceList) {
    const span = document.createElement('span');
    span.textContent = `\\librecite{${key}}`;
    block.appendChild(span);
  }

  container.insertBefore(block, container.firstChild);
}

function replaceAllCitationMarkers(nodeMap, formattedCitations, config, bibHtmlByKey) {
  for (const [textNode, instances] of nodeMap) {
    replaceNodeCitations(textNode, instances, formattedCitations, config, bibHtmlByKey);
  }
}

function replaceNodeCitations(textNode, instances, formattedCitations, config, bibHtmlByKey) {
  const text = textNode.textContent;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const { keys, matchIndex, matchLen, instanceIndex } of instances) {
    if (matchIndex > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
    }

    const formattedHtml = formattedCitations[instanceIndex] ?? '?';

    // Some CSL styles (e.g. AMA) emit their own <sup> via vertical-align="sup".
    // Only add a <sup> wrapper when the format wants superscript AND citeproc
    // hasn't already produced one (avoids double-nesting).
    const hasSup = formattedHtml.includes('<sup');
    const tag = config.superscript && !hasSup ? 'sup' : 'span';
    const elem = document.createElement(tag);
    elem.className = 'librecite';
    elem.dataset.citationKeys = keys.join(',');
    elem.innerHTML = formattedHtml;
    elem.setAttribute('tabindex', '0');
    elem.setAttribute('role', 'button');

    const scrollToRef = () => {
      for (const key of keys) {
        const target = document.getElementById(`ref-${key}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
          break;
        }
      }
    };

    elem.addEventListener('click', scrollToRef);
    elem.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        scrollToRef();
      }
    });

    // Build tooltip content from bibliography entries for each cited key
    const tooltipHtml = keys
      .map(k => bibHtmlByKey?.get(k))
      .filter(Boolean)
      .map(html => `<div class="bib-entry">${html}</div>`)
      .join('');

    if (tooltipHtml) {
      tippy(elem, {
        content: tooltipHtml,
        allowHTML: true,
        theme: 'librecite',
        placement: 'top',
        maxWidth: 420,
        interactive: true,        // lets users click links inside the tooltip
        appendTo: document.body,  // avoids overflow-hidden clipping
      });
    }

    fragment.appendChild(elem);
    lastIndex = matchIndex + matchLen;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  textNode.parentNode.replaceChild(fragment, textNode);
}

function appendReferencesSection(engine, config, displayLocation, pageID, backmatterPageID) {
  const [params, bibEntries] = engine.makeBibliography();
  if (!bibEntries?.length) return;

  // params.entry_ids is [[id1], [id2], ...] – one inner array per entry
  const entryIds = params.entry_ids ?? [];

  // Use a pre-existing #reference-output placeholder, or create a new section.
  let container = document.getElementById('reference-output');
  if (!container) {
    const section = document.createElement('section');
    section.id = 'references';
    const heading = document.createElement('h2');
    heading.textContent = config.heading;
    section.appendChild(heading);
    document.body.appendChild(section);
    container = section;
  }

  if (displayLocation === 'backmatter' && pageID === backmatterPageID) {
    container.style.display = 'block';
  } else if (displayLocation !== 'endOfPage') {
    container.style.display = 'none';
  }

  const list = document.createElement(config.listType);
  list.className = 'references-list';

  bibEntries.forEach((entryHtml, i) => {
    const key = entryIds[i]?.[0];
    const li = document.createElement('li');
    if (key) li.id = `ref-${key}`;

    // Citeproc wraps each entry in <div class="csl-entry">; unwrap for clean
    // <li> content that matches the existing page CSS expectations.
    const temp = document.createElement('div');
    temp.innerHTML = entryHtml;
    const cslEntry = temp.querySelector('.csl-entry');
    li.innerHTML = cslEntry ? cslEntry.innerHTML : entryHtml;

    list.appendChild(li);
  });

  container.appendChild(list);
}

// ─── Data Conversion ─────────────────────────────────────────────────────────

function toCslJson(item) {
  return {
    id: item.citationKey,
    type: ENTRY_TYPE_MAP[item.entryType?.toLowerCase()] ?? 'document',
    title: item.title ?? 'Untitled',
    author: parseAuthorToCsl(item.author),
    issued: item.year ? { 'date-parts': [[Number(item.year)]] } : undefined,
    'container-title': item.journal ?? item.booktitle ?? undefined,
    volume: item.volume ?? undefined,
    issue: item.number ?? undefined,
    page: item.pages?.replace(/--/g, '-') ?? undefined,
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
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => {
      if (name.includes(',')) {
        const commaIdx = name.indexOf(',');
        return {
          family: name.slice(0, commaIdx).trim(),
          given: name.slice(commaIdx + 1).trim(),
        };
      }
      const parts = name.split(/\s+/);
      return {
        family: parts[parts.length - 1],
        given: parts.slice(0, -1).join(' '),
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
