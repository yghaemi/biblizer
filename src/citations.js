// @ts-check
/**
 * @typedef {import('./types').CitationInstance} CitationInstance
 * @typedef {import('./types').NodeCitationMeta} NodeCitationMeta
 * @typedef {import('./types').FormatConfig}     FormatConfig
 */

import tippy from "tippy.js";

// ─── Citation Collection ─────────────────────────────────────────────────────

// Returns every \librecite{...} occurrence in document order (duplicates
// included), grouped by text node for efficient DOM replacement.
export function collectAllCitationInstances(root) {
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

export function parseCitationKeys(content) {
  return content
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
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
export function injectCitationMarkers(referenceList) {
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

export function replaceAllCitationMarkers(
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

export function replaceNodeCitations(
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
