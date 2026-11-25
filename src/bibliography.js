// @ts-check
/**
 * @typedef {import('./types').ScopeGroup}     ScopeGroup
 * @typedef {import('./types').FormatConfig}   FormatConfig
 * @typedef {import('./types').CiteprocEngine} CiteprocEngine
 */

import tippy from "tippy.js";
import { LIBRARY } from "./config.js";
import { escapeHtml } from "./utils.js";

// ─── Bibliography containers ────────────────────────────────────────────────
// A page's bibliography renders into
//   <div class="reference-output" id="reference-output-{pageID}">

/** @param {string} pageID */
export function referenceOutputId(pageID) {
  return `reference-output-${pageID}`;
}

/**
 * Remove every .reference-output that belongs to another page (carried in by
 * transclusion).
 * @param {string} pageID
 */
export function removeForeignReferenceOutputs(pageID) {
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
export function getOrCreateReferenceOutput(pageID) {
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
export function isGroupTarget(pageID, displayGroups, groups) {
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
export function whenElementPresent(id, callback) {
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
export function appendReferencesSection(engine, config, container, refUsageMap) {
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
