// ─── API – Page info ─────────────────────────────────────────────────────────

/**
 * Response from GET /page/:pageID/library/:library
 */
export interface PageInfo {
  projectID: string;
  lastUpdatedAt: string;
  /** Citation style: "APA" | "MLA" | "Chicago" | "Harvard" | "Vancouver" |
   *  "IEEE" | "AMA" | "CSM" | "ASN" | "ANSI" */
  format: string;
  /** Where to render the bibliography section. */
  displayLocation: "endOfPage" | "backmatter" | "endOfChapter" | (string & {});
  pageTitle: string;
  /** ID of the page that acts as the backmatter / reference list page. */
  backmatterPageID: string;
  /** Ordered list of citation keys shown on the backmatter page. */
  backmatterReferenceList: string[];
  /** Page IDs that belong to a group sharing a single bibliography. */
  selectedList: string[];
}

// ─── API – Project data ───────────────────────────────────────────────────────

/**
 * A single bibliographic reference as returned by the API.
 * Field names mirror BibTeX conventions.
 */
export interface ReferenceItem {
  citationKey: string;
  /** BibTeX entry type: "article" | "book" | "incollection" | "misc" | … */
  entryType: string;
  author?: string;
  title?: string;
  journal?: string;
  booktitle?: string;
  volume?: string;
  /** Issue / number field (BibTeX "number"). */
  number?: string;
  pages?: string;
  year?: string;
  url?: string;
  publisher?: string;
  note?: string;
}

/**
 * Response from GET /projects/:projectID
 */
export interface ProjectData {
  referenceItems: ReferenceItem[];
  toc: TocNode;
}

// ─── API – TOC ────────────────────────────────────────────────────────────────

/**
 * Recursive table-of-contents node.
 * `refs` holds the citation keys explicitly listed on that page.
 */
export interface TocNode {
  id: string;
  title: string;
  refs: string[];
  children: TocNode[];
}

// ─── Cache ────────────────────────────────────────────────────────────────────

/** Shape stored in localStorage for a project's reference data. */
export interface CachedProjectData {
  lastUpdatedAt: string;
  referenceItems: ReferenceItem[];
  toc: TocNode;
}

// ─── Format config ────────────────────────────────────────────────────────────

/**
 * Per-format rendering options stored in FORMAT_CONFIG.
 */
export interface FormatConfig {
  /** CSL style identifier used by citeproc. */
  cslStyle: string;
  /** Heading text for the bibliography section. */
  heading: string;
  /** HTML list element type for the bibliography. */
  listType: "ol" | "ul";
  /**
   * When true the in-text citation element is wrapped in `<sup>` —
   * unless citeproc already emitted a `<sup>` tag itself.
   */
  superscript: boolean;
}

// ─── CSL-JSON ────────────────────────────────────────────────────────────────

/** A single author / editor name in CSL-JSON format. */
export interface CslAuthor {
  family: string;
  given: string;
}

/** CSL-JSON date representation. */
export interface CslDate {
  "date-parts": [[number]];
}

/** CSL-JSON item — the format consumed by citeproc-js. */
export interface CslJson {
  id: string;
  /** CSL item type: "article-journal" | "chapter" | "book" | "webpage" | … */
  type: string;
  title: string;
  author: CslAuthor[];
  issued?: CslDate;
  "container-title"?: string;
  volume?: string;
  issue?: string;
  page?: string;
  URL?: string;
  publisher?: string;
  note?: string;
}

// ─── Internal citation collection ────────────────────────────────────────────

/** One occurrence of a \librecite{…} marker in the document. */
export interface CitationInstance {
  /** Citation keys contained in this marker (may be multiple). */
  keys: string[];
}

/** Metadata attached to a single \librecite match within a text node. */
export interface NodeCitationMeta {
  keys: string[];
  /** Character offset of the match start within the text node. */
  matchIndex: number;
  /** Length of the matched string (including \librecite{…} delimiters). */
  matchLen: number;
  /** Index into the flat `allInstances` array (= citeproc citation index). */
  instanceIndex: number;
}

// ─── Citeproc engine (lightweight ambient shape) ─────────────────────────────

/**
 * Minimal type for the raw citeproc engine returned by
 * `plugins.config.get('@csl').engine(…)`.
 * The full citeproc-js API is more complex; only the methods used here
 * are typed.
 */
export interface CiteprocEngine {
  /** Register which items participate in the document. */
  updateItems(ids: string[]): void;
  /**
   * Process one citation cluster in document order.
   * Returns `[status, [[position, formattedText, citationID], …]]`.
   */
  processCitationCluster(
    citation: CiteprocCitation,
    pre: [string, number][],
    post: [string, number][]
  ): [number, [number, string, string][]];
  /**
   * Generate the full bibliography after all citations have been processed.
   * Returns `[params, htmlEntries]`.
   */
  makeBibliography(): [CiteprocBibParams, string[]];
}

export interface CiteprocCitation {
  citationID: string;
  citationItems: { id: string }[];
  properties: { noteIndex: number };
}

export interface CiteprocBibParams {
  /** `[[id], [id], …]` — one inner array per bibliography entry. */
  entry_ids: string[][];
  bibstart: string;
  bibend: string;
  maxoffset: number;
  entryspacing: number;
  linespacing: number;
}
