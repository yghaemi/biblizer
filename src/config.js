// @ts-check
/**
 * @typedef {import('./types').FormatConfig} FormatConfig
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const API_BASE = `${process.env.API_HOST}/api/v1/reference`;
export const CACHE_PREFIX = "libretexts-references:";

export const DEKI_TOKEN_URL = "https://cdn.libretexts.net/authenBrowser.json";

// Stand-in script URL for resolving ../src/csl/ when document.currentScript is
// unavailable (tests, inlined/evaluated bundles).
export const CSL_FALLBACK_SCRIPT_URL =
  "https://cdn.jsdelivr.net/gh/yghaemi/biblizer@master/dist/script.min.js";

/** LibreTexts library keys, used to recover the library from native or proxied hosts. */
export const LIBRARY_KEYS = new Set([
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
  "workforce",
]);

export const LIBRARY = extractLibrary(window.location.hostname);

// ─── Format config ────────────────────────────────────────────────────────────
// cslStyle   – name passed to citeproc engine
// heading    – h2 text for the references section
// listType   – ol (numbered) or ul (author-date)
// superscript – wrap in-text citation in <sup> when citeproc hasn't already done so

export const FORMAT_CONFIG = {
  IEEE: {
    cslStyle: "ieee",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  Vancouver: {
    cslStyle: "vancouver",
    heading: "References",
    listType: "ul",
    superscript: false,
  },
  AMA: {
    cslStyle: "american-medical-association",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  ACS:{
    cslStyle: "american-chemical-society",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  CSM: {
    cslStyle: "ieee",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  ASN: {
    cslStyle: "american-medical-association",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  ANSI: {
    cslStyle: "ieee",
    heading: "References",
    listType: "ul",
    superscript: true,
  },
  APA: {
    cslStyle: "apa",
    heading: "References",
    listType: "ul",
    superscript: false,
  },
  MLA: {
    cslStyle: "modern-language-association",
    heading: "Works Cited",
    listType: "ul",
    superscript: false,
  },
  Chicago: {
    cslStyle: "chicago-author-date",
    heading: "References",
    listType: "ul",
    superscript: false,
  },
  Harvard: {
    cslStyle: "harvard1",
    heading: "Reference List",
    listType: "ul",
    superscript: false,
  },
};


export function getFormatConfig(format) {
  return FORMAT_CONFIG[format] ?? FORMAT_CONFIG.IEEE;
}

/**
 * Resolve the LibreTexts library key from the page hostname.
 *
 * Native hosts look like `chem.libretexts.org`. Proxies such as Google
 * Translate rewrite that to `chem-libretexts-org.translate.goog`, so the
 * first label is no longer the library key. Match a known key from either
 * form; fall back to `dev` when none is recognized.
 *
 * @param {string} hostname
 * @returns {string}
 */
export function extractLibrary(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    return "dev";
  }

  // chem-libretexts-org.translate.goog → chem
  const proxied = host.match(/(?:^|\.)([a-z0-9]+)-libretexts-org(?:\.|$)/);
  if (proxied && LIBRARY_KEYS.has(proxied[1])) {
    return proxied[1];
  }

  // chem.libretexts.org → chem
  const subdomain = host.split(".")[0];
  if (LIBRARY_KEYS.has(subdomain)) {
    return subdomain;
  }

  return "dev";
}
