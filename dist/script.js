(() => {
  // src/config.js
  var API_BASE = `${"https://knitcanvas.fun"}/api/v1/reference`;
  var CACHE_PREFIX = "libretexts-references:";
  var DEKI_TOKEN_URL = "https://cdn.libretexts.net/authenBrowser.json";
  var FALLBACK_SCRIPT_URL = "https://cdn.jsdelivr.net/gh/yghaemi/biblizer@master/dist/script.min.js";
  var LIBRARY_KEYS = /* @__PURE__ */ new Set([
    "bio",
    "biz",
    "chem",
    "dev",
    "eng",
    "espanol",
    "geo",
    "human",
    "k12",
    "math",
    "med",
    "phys",
    "socialsci",
    "stats",
    "workforce"
  ]);
  var LIBRARY = extractLibrary(window.location.hostname);
  function extractLibrary(hostname) {
    const host = String(hostname || "").toLowerCase();
    if (host.includes("localhost") || host.includes("127.0.0.1")) {
      return "dev";
    }
    const proxied = host.match(/(?:^|\.)([a-z0-9]+)-libretexts-org(?:\.|$)/);
    if (proxied && LIBRARY_KEYS.has(proxied[1])) {
      return proxied[1];
    }
    const subdomain = host.split(".")[0];
    if (LIBRARY_KEYS.has(subdomain)) {
      return subdomain;
    }
    return "dev";
  }

  // src/api.js
  function getGlobalSettingsPageId() {
    const el = document.getElementById("mt-global-settings");
    if (!el?.textContent) return null;
    try {
      const settings = JSON.parse(el.textContent);
      return settings.pageId != null && settings.pageId !== "" ? String(settings.pageId) : null;
    } catch (err) {
      console.warn("failed to parse #mt-global-settings:", err);
      return null;
    }
  }
  async function fetchCurrentPageId(library) {
    const tokenResponse = await fetch(DEKI_TOKEN_URL);
    if (!tokenResponse.ok) throw new Error(`HTTP ${tokenResponse.status} for ${DEKI_TOKEN_URL}`);
    const tokens = await tokenResponse.json();
    const token = tokens[library];
    if (!token) throw new Error(`No x-deki-token for library "${library}"`);
    const path = window.location.pathname.replace(/^\//, "");
    const encodedPath = encodeURIComponent(encodeURIComponent(path));
    const url = `https://${library}.libretexts.org/@api/deki/pages/=${encodedPath}?dream.out.format=json`;
    const response = await fetch(url, {
      headers: { "x-deki-token": token, "x-requested-with": "XMLHttpRequest" }
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
  function setCachedReferences(projectID, lastUpdatedAt, { referenceItems, toc }) {
    localStorage.setItem(
      getCacheKey(projectID),
      JSON.stringify({ lastUpdatedAt, referenceItems, toc })
    );
  }
  function isCacheValid(cached, lastUpdatedAt) {
    return !!(cached?.lastUpdatedAt && cached.referenceItems && new Date(cached.lastUpdatedAt) >= new Date(lastUpdatedAt));
  }
  async function getReferences(projectID, lastUpdatedAt) {
    const cached = getCachedReferences(projectID);
    if (isCacheValid(cached, lastUpdatedAt)) {
      return { referenceItems: cached.referenceItems, toc: cached.toc };
    }
    const data = await fetchJSON(`${API_BASE}/projects/${projectID}`);
    setCachedReferences(projectID, lastUpdatedAt, {
      referenceItems: data.referenceItems,
      toc: data.toc
    });
    return { referenceItems: data.referenceItems, toc: data.toc };
  }

  // src/toc.js
  function collectScopeRefs(displayLocation, toc, pageID, backmatterReferenceList, groups) {
    if (displayLocation === "endOfChapter") {
      const group = groups?.find((g) => g.pageIds.map(String).includes(pageID));
      return group ? collectGroupRefs(toc, group.pageIds) : collectChapterRefs(toc, pageID);
    }
    if (displayLocation === "backmatter") {
      return backmatterReferenceList?.length ? [...backmatterReferenceList] : collectAllTocRefs(toc);
    }
    return [];
  }
  function collectChapterRefs(toc, pageId) {
    if (!toc) return [];
    const nodeMap = /* @__PURE__ */ new Map();
    const parentMap = /* @__PURE__ */ new Map();
    (function index(node2, parent) {
      nodeMap.set(String(node2.id), node2);
      if (parent) parentMap.set(String(node2.id), parent);
      for (const child of node2.children ?? []) index(child, node2);
    })(toc, null);
    let node = nodeMap.get(String(pageId));
    if (!node) return [];
    while (true) {
      const parent = parentMap.get(String(node.id));
      if (!parent) return [];
      if (!parentMap.has(String(parent.id))) break;
      node = parent;
    }
    return subtreeRefs(node);
  }
  function collectGroupRefs(toc, pageIds) {
    if (!toc) return [];
    const members = new Set(pageIds.map(String));
    const refs = /* @__PURE__ */ new Set();
    (function visit(node) {
      if (members.has(String(node.id))) {
        for (const ref of node.refs ?? []) refs.add(ref);
      }
      for (const child of node.children ?? []) visit(child);
    })(toc);
    return [...refs];
  }
  function collectAllTocRefs(toc) {
    return toc ? subtreeRefs(toc) : [];
  }
  function subtreeRefs(root) {
    const refs = /* @__PURE__ */ new Set();
    const queue = [root];
    while (queue.length > 0) {
      const node = queue.shift();
      for (const ref of node.refs ?? []) refs.add(ref);
      for (const child of node.children ?? []) queue.push(child);
    }
    return [...refs];
  }

  // src/containers.js
  function referenceOutputId(pageID) {
    return `reference-output-${pageID}`;
  }
  function removeForeignReferenceOutputs(pageID) {
    const ownId = referenceOutputId(pageID);
    for (const el of document.querySelectorAll(".reference-output")) {
      if (el.id !== ownId) el.remove();
    }
  }
  function isGroupTarget(pageID, displayGroups, groups) {
    return [...displayGroups ?? [], ...groups ?? []].some(
      (g) => String(g.targetPageId) === pageID
    );
  }

  // src/engineLoader.js
  var loadEngine = (scriptUrl) => import(new URL("engine.js", scriptUrl).href);

  // src/utils.js
  function termAnchorId(term) {
    return "gt-anchor-" + String(term).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  // src/script.js
  var SCRIPT_URL = (
    /** @type {HTMLScriptElement|null} */
    document.currentScript?.src || FALLBACK_SCRIPT_URL
  );
  document.addEventListener("DOMContentLoaded", async () => {
    const settingsPageId = getGlobalSettingsPageId();
    const pageIdPromise = settingsPageId ? Promise.resolve(settingsPageId) : fetchCurrentPageId(LIBRARY).catch((err) => {
      console.warn("Deki pageID lookup failed:", err);
      return null;
    });
    const pageID = await pageIdPromise;
    if (!pageID) {
      console.error(
        "no pageID available (#mt-global-settings and Deki lookup both failed); skipping render"
      );
      return;
    }
    removeForeignReferenceOutputs(pageID);
    try {
      const pageInfo = await fetchJSON(
        `${API_BASE}/page/${pageID}/library/${LIBRARY}`
      );
      const { displayLocation } = pageInfo;
      const hasMarkers = document.body.textContent.includes("\\librecite{");
      if (!hasMarkers && displayLocation !== "endOfChapter" && displayLocation !== "backmatter") {
        return;
      }
      const { referenceItems, toc } = await getReferences(
        pageInfo.projectID,
        pageInfo.lastUpdatedAt
      );
      const scopeRefs = collectScopeRefs(
        displayLocation,
        toc,
        pageID,
        pageInfo.backmatterReferenceList,
        pageInfo.scope?.groups
      );
      if (!hasMarkers && !rendersScopeBibliography(pageID, pageInfo, scopeRefs)) return;
      const { renderCitations } = await loadEngine(SCRIPT_URL);
      await renderCitations({ pageID, pageInfo, referenceItems, toc, scopeRefs, scriptUrl: SCRIPT_URL });
    } catch (err) {
      console.error("Failed to load citations:", err);
    }
  });
  function rendersScopeBibliography(pageID, pageInfo, scopeRefs) {
    if (scopeRefs.length === 0) return false;
    switch (pageInfo.displayLocation) {
      case "endOfChapter":
        return isGroupTarget(pageID, pageInfo.displayGroups, pageInfo.scope?.groups) || !!document.getElementById(referenceOutputId(pageID));
      case "backmatter":
        return pageID === String(pageInfo.backmatterPageID);
      default:
        return false;
    }
  }
  globalThis.termAnchorId = termAnchorId;
  globalThis.escapeHtml = escapeHtml;
})();
