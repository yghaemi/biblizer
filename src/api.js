// @ts-check
/**
 * @typedef {import('./types').PageInfo}          PageInfo
 * @typedef {import('./types').ProjectData}       ProjectData
 * @typedef {import('./types').CachedProjectData} CachedProjectData
 */

import { API_BASE, CACHE_PREFIX, DEKI_TOKEN_URL } from "./config.js";

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Read the current page's id from MindTouch's #mt-global-settings JSON blob.
 * @returns {string | null}
 */
export function getGlobalSettingsPageId() {
  const el = document.getElementById("mt-global-settings");
  if (!el?.textContent) return null;
  try {
    const settings = JSON.parse(el.textContent);
    return settings.pageId != null && settings.pageId !== ""
      ? String(settings.pageId)
      : null;
  } catch (err) {
    console.warn("failed to parse #mt-global-settings:", err);
    return null;
  }
}

/**
 * Look up the current page's id through MindTouch's Deki API, keyed off
 * window.location.
 * @param {string} library
 * @returns {Promise<string>}
 */
export async function fetchCurrentPageId(library) {
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

export async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const json = await response.json();
  if (json.err) throw new Error(`API error for ${url}`);
  return json.data;
}

export function getCacheKey(projectID) {
  return `${CACHE_PREFIX}${projectID}`;
}

export function getCachedReferences(projectID) {
  const raw = localStorage.getItem(getCacheKey(projectID));
  return raw ? JSON.parse(raw) : null;
}

export function setCachedReferences(
  projectID,
  lastUpdatedAt,
  { referenceItems, toc },
) {
  localStorage.setItem(
    getCacheKey(projectID),
    JSON.stringify({ lastUpdatedAt, referenceItems, toc }),
  );
}

export function isCacheValid(cached, lastUpdatedAt) {
  return !!(
    cached?.lastUpdatedAt &&
    cached.referenceItems &&
    new Date(cached.lastUpdatedAt) >= new Date(lastUpdatedAt)
  );
}

export async function getReferences(projectID, lastUpdatedAt) {
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
