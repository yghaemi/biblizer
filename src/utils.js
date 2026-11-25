// @ts-check

// ─── Utilities ────────────────────────────────────────────────────────────────
// Stable anchor id for a term. Must match termAnchorId() in glossarizer.js.
export function termAnchorId(term) {
  return (
    "gt-anchor-" +
    String(term)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
