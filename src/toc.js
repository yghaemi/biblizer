// @ts-check
/**
 * @typedef {import('./types').TocNode}    TocNode
 * @typedef {import('./types').ScopeGroup} ScopeGroup
 */

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
export function collectScopeRefs(
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
export function collectChapterRefs(toc, pageId) {
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
export function collectGroupRefs(toc, pageIds) {
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
export function collectAllTocRefs(toc) {
  return toc ? subtreeRefs(toc) : [];
}

/**
 * BFS over a TOC subtree, accumulating ref keys in first-seen order.
 *
 * @param {TocNode} root
 * @returns {string[]}
 */
export function subtreeRefs(root) {
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
export function buildRefUsageMap(toc) {
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
