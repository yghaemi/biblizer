// @ts-check
/**
 * @typedef {import('./types').ReferenceItem} ReferenceItem
 * @typedef {import('./types').CslJson}       CslJson
 * @typedef {import('./types').CslAuthor}     CslAuthor
 */

// ─── Data Conversion ─────────────────────────────────────────────────────────
// BibTeX entry types → CSL types
export const ENTRY_TYPE_MAP = {
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

export function toCslJson(item) {
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
export function parseAuthorToCsl(authorString) {
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
