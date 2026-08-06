const API_BASE = "https://memorial-william-afford-info.trycloudflare.com/api/v1/reference";
const CACHE_PREFIX = "libretexts-references:";
const page_url = window.location.hostname;

function extract_library(hostname) {
  if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) {
    return "dev";
  }
  const parts = hostname.split(".");
  return parts?.[0]?.toLowerCase() ?? "dev";
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

const LIBRARY = extract_library(page_url);


const FORMAT_CONFIG = {
  IEEE: { numbered: true, heading: "References", listType: "ol" },
  Vancouver: { numbered: true, heading: "References", listType: "ol" },
  AMA: { numbered: true, heading: "References", listType: "ol" },
  CSM: { numbered: true, heading: "References", listType: "ol" },
  ASN: { numbered: true, heading: "References", listType: "ol" },
  ANSI: { numbered: true, heading: "References", listType: "ol" },
  APA: { numbered: false, heading: "References", listType: "ul" },
  MLA: { numbered: false, heading: "Works Cited", listType: "ul" },
  Chicago: { numbered: false, heading: "References", listType: "ul" },
  Harvard: { numbered: false, heading: "Reference List", listType: "ul" },
};

document.addEventListener("DOMContentLoaded", async function () {
  const pageID = document.getElementById("pageID")?.value;
  if (!pageID) {
    console.error("pageID not found");
    return;
  }

  try {
    const pageInfo = await fetchJSON(
      `${API_BASE}/page/${pageID}/library/${LIBRARY}`,
    );
    const { projectID, lastUpdatedAt, format } = pageInfo;
    const referenceItems = await getReferences(projectID, lastUpdatedAt);
    const referencesByKey = Object.fromEntries(
      referenceItems.map((item) => [item.citationKey, item]),
    );

    const citationOrder = collectCitationOrder(document.body);
    const keyToNumber = Object.fromEntries(
      citationOrder.map((key, index) => [key, index + 1]),
    );
    const bibliographyOrder = getBibliographyOrder(
      citationOrder,
      referencesByKey,
      format,
    );

    replaceLibreciteMarkers(
      document.body,
      keyToNumber,
      referencesByKey,
      format,
    );
    appendReferencesSection(
      bibliographyOrder,
      referencesByKey,
      format,
      keyToNumber,
    );
  } catch (error) {
    console.error("Failed to load citations:", error);
  }
});

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const json = await response.json();
  if (json.err) {
    throw new Error(`API error for ${url}`);
  }

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
  if (!cached?.lastUpdatedAt || !cached.referenceItems) {
    return false;
  }

  return new Date(cached.lastUpdatedAt) >= new Date(lastUpdatedAt);
}

async function getReferences(projectID, lastUpdatedAt) {
  const cached = getCachedReferences(projectID);
  if (isCacheValid(cached, lastUpdatedAt)) {
    return cached.referenceItems;
  }

  const data = await fetchJSON(`${API_BASE}/projects/${projectID}`);
  setCachedReferences(projectID, lastUpdatedAt, data.referenceItems);
  return data.referenceItems;
}

const LIBRECITE_PATTERN = /\\librecite\{([^}]+)\}/g;

function parseCitationKeys(content) {
  return content.split(",").map((key) => key.trim()).filter(Boolean);
}

function getFormatConfig(format) {
  return FORMAT_CONFIG[format] ?? FORMAT_CONFIG.IEEE;
}

function isNumberedFormat(format) {
  return getFormatConfig(format).numbered;
}

function getBibliographyOrder(citationOrder, referencesByKey, format) {
  if (isNumberedFormat(format)) {
    return citationOrder;
  }

  return [...citationOrder].sort((keyA, keyB) => {
    const nameA = getPrimaryAuthorLastName(referencesByKey[keyA], keyA);
    const nameB = getPrimaryAuthorLastName(referencesByKey[keyB], keyB);
    return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
  });
}

function collectCitationOrder(root) {
  const order = [];
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const match of node.textContent.matchAll(LIBRECITE_PATTERN)) {
      for (const key of parseCitationKeys(match[1])) {
        if (!seen.has(key)) {
          seen.add(key);
          order.push(key);
        }
      }
    }
  }

  return order;
}

function replaceLibreciteMarkers(root, keyToNumber, referencesByKey, format) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent.includes("\\librecite{")) {
      textNodes.push(node);
    }
  }

  for (const textNode of textNodes) {
    replaceLibreciteInTextNode(
      textNode,
      keyToNumber,
      referencesByKey,
      format,
    );
  }
}

function replaceLibreciteInTextNode(
  textNode,
  keyToNumber,
  referencesByKey,
  format,
) {
  const text = textNode.textContent;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of text.matchAll(LIBRECITE_PATTERN)) {
    const keys = parseCitationKeys(match[1]);

    if (match.index > lastIndex) {
      fragment.appendChild(
        document.createTextNode(text.slice(lastIndex, match.index)),
      );
    }

    const cite = createInTextCitationElement(
      keys,
      keyToNumber,
      referencesByKey,
      format,
    );
    fragment.appendChild(cite);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex === 0) {
    return;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  textNode.parentNode.replaceChild(fragment, textNode);
}

function createInTextCitationElement(
  keys,
  keyToNumber,
  referencesByKey,
  format,
) {
  const { text, superscript } = formatInTextCitation(
    format,
    keys,
    keyToNumber,
    referencesByKey,
  );
  const cite = document.createElement(superscript ? "sup" : "span");
  cite.className = "librecite";
  cite.dataset.citationKeys = keys.join(",");
  cite.textContent = text;
  cite.addEventListener("click", () => {
    for (const key of keys) {
      const target = document.getElementById(`ref-${key}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth" });
        break;
      }
    }
  });
  return cite;
}

function formatInTextCitation(format, keys, keyToNumber, referencesByKey) {
  switch (format) {
    case "APA":
      return {
        text: formatAuthorDateInText(keys, referencesByKey, { comma: true }),
        superscript: false,
      };
    case "Harvard":
      return {
        text: formatAuthorDateInText(keys, referencesByKey, { comma: true }),
        superscript: false,
      };
    case "Chicago":
      return {
        text: formatAuthorDateInText(keys, referencesByKey, { comma: false }),
        superscript: false,
      };
    case "MLA":
      return { text: formatMLAInText(keys, referencesByKey), superscript: false };
    case "Vancouver":
      return {
        text: formatDelimitedNumbers(keys, keyToNumber, "(", ",", ")"),
        superscript: false,
      };
    case "AMA":
    case "ASN":
      return {
        text: formatDelimitedNumbers(keys, keyToNumber, "", ",", ""),
        superscript: true,
      };
    case "IEEE":
    case "CSM":
    case "ANSI":
      return {
        text: formatDelimitedNumbers(keys, keyToNumber, "[", ",", "]"),
        superscript: true,
      };
    default:
      return {
        text: formatDelimitedNumbers(keys, keyToNumber, "[", ",", "]"),
        superscript: true,
      };
  }
}

function formatDelimitedNumbers(keys, keyToNumber, prefix, separator, suffix) {
  const numbers = keys.map((key) => keyToNumber[key] ?? "?");
  return `${prefix}${numbers.join(separator)}${suffix}`;
}

function formatAuthorDateInText(keys, referencesByKey, { comma }) {
  const separator = comma ? "; " : "; ";
  const parts = keys.map((key) => {
    const item = referencesByKey[key];
    if (!item) {
      return "?";
    }

    const author = getInTextAuthorLabel(item.author);
    const year = item.year || "n.d.";
    return comma ? `${author}, ${year}` : `${author} ${year}`;
  });

  return `(${parts.join(separator)})`;
}

function formatMLAInText(keys, referencesByKey) {
  const parts = keys.map((key) => {
    const item = referencesByKey[key];
    if (!item) {
      return "?";
    }

    const author = getInTextAuthorLabel(item.author);
    const page = getFirstPage(item.pages);
    return page ? `${author} ${page}` : author;
  });

  return `(${parts.join("; ")})`;
}

function appendReferencesSection(
  bibliographyOrder,
  referencesByKey,
  format,
  keyToNumber,
) {
  if (bibliographyOrder.length === 0) {
    return;
  }

  const config = getFormatConfig(format);
  const section =document.getElementById("reference-output");

  const heading = document.createElement("h2");
  heading.textContent = config.heading;
  section.appendChild(heading);

  const list = document.createElement(config.listType);
  list.className = "references-list";

  for (const key of bibliographyOrder) {
    const item = referencesByKey[key];
    const entry = document.createElement("li");
    entry.id = `ref-${key}`;

    if (config.listType === "ol") {
      entry.value = keyToNumber[key];
    }

    entry.innerHTML = item
      ? formatReference(item, format, keyToNumber[key])
      : `Missing reference: ${escapeHtml(key)}`;
    list.appendChild(entry);
  }

  section.appendChild(list);
}

function formatReference(item, format, number) {
  switch (format) {
    case "APA":
      return formatAPAReference(item);
    case "MLA":
      return formatMLAReference(item);
    case "Chicago":
      return formatChicagoReference(item);
    case "Harvard":
      return formatHarvardReference(item);
    case "Vancouver":
      return formatVancouverReference(item, number);
    case "AMA":
      return formatAMAReference(item, number);
    case "CSM":
      return formatCSMReference(item, number);
    case "ASN":
      return formatASNReference(item, number);
    case "ANSI":
      return formatANSIReference(item, number);
    case "IEEE":
    default:
      return formatIEEEReference(item, number);
  }
}

function formatIEEEReference(item, number) {
  const author = formatAuthorsInitialsLast(item.author);
  const title = escapeHtml(item.title || "Untitled");

  switch (item.entryType) {
    case "article": {
      const journal = escapeHtml(item.journal || "");
      const volume = item.volume ? `, vol. ${escapeHtml(item.volume)}` : "";
      const issue = item.number ? `, no. ${escapeHtml(item.number)}` : "";
      const pages = item.pages ? `, pp. ${escapeHtml(item.pages)}` : "";
      const year = item.year ? `, ${escapeHtml(item.year)}` : "";
      return `${author}, "${title}," <i>${journal}</i>${volume}${issue}${pages}${year}.`;
    }
    case "incollection": {
      const publisher = escapeHtml(item.publisher || "");
      const pages = item.pages ? `, pp. ${escapeHtml(item.pages)}` : "";
      const year = item.year ? `, ${escapeHtml(item.year)}` : "";
      return `${author}, "${title}," in <i>${publisher}</i>${year}${pages}.`;
    }
    default:
      return formatWebReferenceNumbered(
        author,
        title,
        item,
        number ? `[${number}] ` : "",
      );
  }
}

function formatAPAReference(item) {
  const author = formatAuthorsAPA(item.author);
  const year = item.year ? ` (${escapeHtml(item.year)}).` : " (n.d.).";
  const title = escapeHtml(item.title || "Untitled");

  switch (item.entryType) {
    case "article": {
      const journal = escapeHtml(item.journal || "");
      const volume = item.volume ? `, <i>${escapeHtml(item.volume)}</i>` : "";
      const issue = item.number ? `(${escapeHtml(item.number)})` : "";
      const pages = item.pages ? `, ${escapeHtml(item.pages.replace("--", "-"))}` : "";
      const doi = item.url
        ? ` ${formatLinkedUrl(item.url)}`
        : "";
      return `${author}${year} ${title}. <i>${journal}</i>${volume}${issue}${pages}.${doi}`;
    }
    case "incollection": {
      const publisher = escapeHtml(item.publisher || "");
      const pages = item.pages ? ` (pp. ${escapeHtml(item.pages.replace("--", "-"))}).` : ".";
      return `${author}${year} ${title}. In <i>${publisher}</i>${pages}`;
    }
    default:
      return `${author}${year} ${title}. ${formatAPASource(item)}`;
  }
}

function formatMLAReference(item) {
  const author = formatAuthorsMLA(item.author);
  const title = `"${escapeHtml(item.title || "Untitled")}."`;

  switch (item.entryType) {
    case "article": {
      const journal = item.journal ? `<i>${escapeHtml(item.journal)}</i>, ` : "";
      const volume = item.volume ? `vol. ${escapeHtml(item.volume)}, ` : "";
      const issue = item.number ? `no. ${escapeHtml(item.number)}, ` : "";
      const year = item.year ? `${escapeHtml(item.year)}, ` : "";
      const pages = item.pages ? `pp. ${escapeHtml(item.pages.replace("--", "-"))}.` : "";
      return `${author} ${title} ${journal}${volume}${issue}${year}${pages}`.trim();
    }
    case "incollection": {
      const publisher = escapeHtml(item.publisher || "");
      const year = item.year ? `${escapeHtml(item.year)}, ` : "";
      const pages = item.pages ? `pp. ${escapeHtml(item.pages.replace("--", "-"))}.` : "";
      return `${author} ${title} <i>${publisher}</i>, ${year}${pages}`.trim();
    }
    default:
      return `${author} ${title} ${formatMLASource(item)}`.trim();
  }
}

function formatChicagoReference(item) {
  const author = formatAuthorsChicago(item.author);
  const year = item.year ? `${escapeHtml(item.year)}.` : "n.d.";
  const title = `"${escapeHtml(item.title || "Untitled")}."`;

  switch (item.entryType) {
    case "article": {
      const journal = item.journal ? `<i>${escapeHtml(item.journal)}</i> ` : "";
      const volume = item.volume ? `${escapeHtml(item.volume)}` : "";
      const issue = item.number ? `, no. ${escapeHtml(item.number)}` : "";
      const pages = item.pages ? `: ${escapeHtml(item.pages.replace("--", "-"))}.` : ".";
      return `${author} ${year} ${title} ${journal}${volume}${issue}${pages}`.trim();
    }
    case "incollection": {
      const publisher = escapeHtml(item.publisher || "");
      const pages = item.pages ? ` (${escapeHtml(item.pages.replace("--", "-"))}).` : ".";
      return `${author} ${year} ${title} In <i>${publisher}</i>${pages}`;
    }
    default:
      return `${author} ${year} ${title} ${formatChicagoSource(item)}`.trim();
  }
}

function formatHarvardReference(item) {
  const author = formatAuthorsHarvard(item.author);
  const year = item.year ? ` (${escapeHtml(item.year)})` : " (n.d.)";
  const title = `'${escapeHtml(item.title || "Untitled")}',`;

  switch (item.entryType) {
    case "article": {
      const journal = item.journal ? `<i>${escapeHtml(item.journal)}</i>, ` : "";
      const volume = item.volume ? `<i>${escapeHtml(item.volume)}</i>` : "";
      const issue = item.number ? `(${escapeHtml(item.number)})` : "";
      const pages = item.pages ? `, pp. ${escapeHtml(item.pages.replace("--", "-"))}.` : ".";
      return `${author}${year} ${title} ${journal}${volume}${issue}${pages}`.trim();
    }
    case "incollection": {
      const publisher = escapeHtml(item.publisher || "");
      const pages = item.pages ? `, pp. ${escapeHtml(item.pages.replace("--", "-"))}.` : ".";
      return `${author}${year} ${title} ${publisher}${pages}`;
    }
    default:
      return `${author}${year} ${title} ${formatHarvardSource(item)}`.trim();
  }
}

function formatVancouverReference(item, number) {
  const prefix = number ? `${number}. ` : "";
  const author = formatAuthorsVancouver(item.author);
  const title = escapeHtml(item.title || "Untitled");

  switch (item.entryType) {
    case "article": {
      const journal = item.journal ? `${escapeHtml(item.journal)}.` : "";
      const year = item.year ? ` ${escapeHtml(item.year)}` : "";
      const volume = item.volume ? `;${escapeHtml(item.volume)}` : "";
      const issue = item.number ? `(${escapeHtml(item.number)})` : "";
      const pages = item.pages ? `:${escapeHtml(item.pages.replace("--", "-"))}.` : ".";
      return `${prefix}${author} ${title}. ${journal}${year}${volume}${issue}${pages}`.trim();
    }
    default:
      return `${prefix}${formatCompactNumberedReference(author, title, item)}`;
  }
}

function formatAMAReference(item, number) {
  const prefix = number ? `${number}. ` : "";
  const author = formatAuthorsVancouver(item.author);
  const title = escapeHtml(item.title || "Untitled");

  switch (item.entryType) {
    case "article": {
      const journal = item.journal ? `<i>${escapeHtml(item.journal)}</i>.` : "";
      const year = item.year ? ` ${escapeHtml(item.year)}` : "";
      const volume = item.volume ? `;${escapeHtml(item.volume)}` : "";
      const issue = item.number ? `(${escapeHtml(item.number)})` : "";
      const pages = item.pages ? `:${escapeHtml(item.pages.replace("--", "-"))}.` : ".";
      return `${prefix}${author} ${title}. ${journal}${year}${volume}${issue}${pages}`.trim();
    }
    default:
      return `${prefix}${formatCompactNumberedReference(author, title, item)}`;
  }
}

function formatCSMReference(item, number) {
  return formatIEEEReference(item, number);
}

function formatASNReference(item, number) {
  return formatAMAReference(item, number);
}

function formatANSIReference(item, number) {
  const prefix = number ? `[${number}] ` : "";
  const author = formatAuthorsInitialsLast(item.author);
  const title = escapeHtml(item.title || "Untitled");
  const year = item.year ? ` (${escapeHtml(item.year)})` : "";
  const source = item.journal
    ? `<i>${escapeHtml(item.journal)}</i>.`
    : escapeHtml(item.publisher || "Online resource");
  const url = item.url ? ` Available: ${formatLinkedUrl(item.url)}` : "";
  return `${prefix}${author}${year}. ${title}. ${source}${url}`;
}

function formatCompactNumberedReference(author, title, item) {
  const year = item.year ? ` ${escapeHtml(item.year)}` : "";
  const publisher = item.publisher ? ` ${escapeHtml(item.publisher)}.` : ".";
  const url = item.url ? ` ${formatLinkedUrl(item.url)}` : "";
  const note = item.note ? ` ${escapeHtml(item.note)}` : "";
  return `${author} ${title}.${publisher}${year}${url}${note}`.trim();
}

function formatWebReferenceNumbered(author, title, item, prefix) {
  const year = item.year ? ` ${escapeHtml(item.year)}.` : ".";
  const url = item.url
    ? ` Available: ${formatLinkedUrl(item.url)}.`
    : "";
  const note = item.note ? ` ${escapeHtml(item.note)}` : "";
  return `${prefix}${author}, "${title},"${year}${url}${note}`.trim();
}

function formatAPASource(item) {
  const publisher = item.publisher ? `${escapeHtml(item.publisher)}.` : "";
  const url = item.url ? ` ${formatLinkedUrl(item.url)}` : "";
  return `${publisher}${url}`.trim();
}

function formatMLASource(item) {
  const publisher = item.publisher ? `<i>${escapeHtml(item.publisher)}</i>, ` : "";
  const year = item.year ? `${escapeHtml(item.year)}, ` : "";
  const url = item.url ? `${formatLinkedUrl(item.url)}.` : "";
  const note = item.note ? ` ${escapeHtml(item.note)}` : "";
  return `${publisher}${year}${url}${note}`.trim();
}

function formatChicagoSource(item) {
  const publisher = item.publisher ? `${escapeHtml(item.publisher)}.` : "";
  const url = item.url ? ` ${formatLinkedUrl(item.url)}.` : "";
  const note = item.note ? ` ${escapeHtml(item.note)}` : "";
  return `${publisher}${url}${note}`.trim();
}

function formatHarvardSource(item) {
  const publisher = item.publisher ? `${escapeHtml(item.publisher)}, ` : "";
  const url = item.url ? `Available at: ${formatLinkedUrl(item.url)} ` : "";
  const note = item.note ? `(${escapeHtml(item.note.replace(/^\[|\]$/g, ""))})` : "";
  return `${publisher}${url}${note}`.trim();
}

function formatLinkedUrl(url) {
  const safeUrl = escapeHtml(url);
  return `<a href="${safeUrl}">${safeUrl}</a>`;
}

function parseAuthorList(author) {
  if (!author) {
    return [];
  }

  return author
    .split(/\s+and\s+/i)
    .flatMap((part) => part.split(/,(?=\s+[A-Z])/))
    .map((name) => name.trim())
    .filter(Boolean);
}

function getAuthorLastName(name) {
  const trimmed = name.trim();
  if (trimmed.includes(",")) {
    return trimmed.split(",")[0].trim();
  }

  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1];
}

function getPrimaryAuthorLastName(item, fallbackKey) {
  const authors = parseAuthorList(item?.author);
  if (authors.length === 0) {
    return item?.title || fallbackKey;
  }

  return getAuthorLastName(authors[0]);
}

function getInTextAuthorLabel(author) {
  const authors = parseAuthorList(author);
  if (authors.length === 0) {
    return "Unknown";
  }
  if (authors.length === 1) {
    return getAuthorLastName(authors[0]);
  }
  if (authors.length === 2) {
    return `${getAuthorLastName(authors[0])} & ${getAuthorLastName(authors[1])}`;
  }

  return `${getAuthorLastName(authors[0])} et al.`;
}

function getFirstPage(pages) {
  if (!pages) {
    return "";
  }

  return pages.split(/[-–—]/)[0].trim();
}

function formatAuthorsInitialsLast(author) {
  const authors = parseAuthorList(author);
  if (authors.length === 0) {
    return "Unknown author";
  }

  return escapeHtml(
    authors
      .map((name) => {
        if (name.includes(",")) {
          const [last, first = ""] = name.split(",").map((part) => part.trim());
          const initials = first
            .split(/\s+/)
            .filter(Boolean)
            .map((part) => `${part[0]}.`)
            .join(" ");
          return initials ? `${initials} ${last}` : last;
        }

        const parts = name.split(/\s+/);
        if (parts.length === 1) {
          return parts[0];
        }

        const lastName = parts[parts.length - 1];
        const initials = parts
          .slice(0, -1)
          .map((part) => `${part[0]}.`)
          .join(" ");
        return `${initials} ${lastName}`;
      })
      .join(", "),
  );
}

function formatAuthorsAPA(author) {
  const authors = parseAuthorList(author);
  if (authors.length === 0) {
    return "Unknown author";
  }

  const formatted = authors.map(formatAuthorAPA);
  if (formatted.length === 1) {
    return formatted[0];
  }
  if (formatted.length <= 20) {
    return `${formatted.slice(0, -1).join(", ")}, & ${formatted[formatted.length - 1]}`;
  }

  return `${formatted.slice(0, 19).join(", ")}, . . . ${formatted[formatted.length - 1]}`;
}

function formatAuthorAPA(name) {
  if (name.includes(",")) {
    const [last, first = ""] = name.split(",").map((part) => part.trim());
    const initials = first
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => `${part[0]}.`)
      .join(" ");
    return escapeHtml(initials ? `${last}, ${initials}` : last);
  }

  const parts = name.split(/\s+/);
  const lastName = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((part) => `${part[0]}.`)
    .join(" ");
  return escapeHtml(`${lastName}, ${initials}`);
}

function formatAuthorsMLA(author) {
  const authors = parseAuthorList(author);
  if (authors.length === 0) {
    return "Unknown author.";
  }

  const first = formatAuthorMLA(authors[0], true);
  if (authors.length === 1) {
    return first;
  }

  const rest = authors.slice(1).map((name) => formatAuthorMLA(name, false));
  return `${first}, ${rest.join(", ")}`;
}

function formatAuthorMLA(name, inverted) {
  if (name.includes(",")) {
    const [last, first = ""] = name.split(",").map((part) => part.trim());
    return escapeHtml(inverted ? `${last}, ${first}` : `${first} ${last}`.trim());
  }

  const parts = name.split(/\s+/);
  const lastName = parts[parts.length - 1];
  const firstNames = parts.slice(0, -1).join(" ");
  return escapeHtml(inverted ? `${lastName}, ${firstNames}` : name);
}

function formatAuthorsChicago(author) {
  return formatAuthorsMLA(author);
}

function formatAuthorsHarvard(author) {
  const authors = parseAuthorList(author);
  if (authors.length === 0) {
    return "Unknown author";
  }

  const formatted = authors.map((name) => {
    if (name.includes(",")) {
      const [last, first = ""] = name.split(",").map((part) => part.trim());
      return escapeHtml(`${last}, ${first}`.trim());
    }
    return escapeHtml(name);
  });

  if (formatted.length === 1) {
    return formatted[0];
  }

  return `${formatted.slice(0, -1).join(", ")} and ${formatted[formatted.length - 1]}`;
}

function formatAuthorsVancouver(author) {
  const authors = parseAuthorList(author);
  if (authors.length === 0) {
    return "Unknown author.";
  }

  const formatted = authors.slice(0, 6).map((name) => {
    if (name.includes(",")) {
      const [last, first = ""] = name.split(",").map((part) => part.trim());
      const initials = first
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase())
        .join("");
      return escapeHtml(`${last} ${initials}`.trim());
    }

    const parts = name.split(/\s+/);
    const lastName = parts[parts.length - 1];
    const initials = parts
      .slice(0, -1)
      .map((part) => part[0].toUpperCase())
      .join("");
    return escapeHtml(`${lastName} ${initials}`.trim());
  });

  if (authors.length > 6) {
    formatted.push("et al");
  }

  return `${formatted.join(", ")}.`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
