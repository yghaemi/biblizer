// @ts-check
/**
 * @typedef {import('./types').ScopeGroup} ScopeGroup
 */

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
