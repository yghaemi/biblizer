// Ambient declarations that must NOT contain top-level `export` statements —
// that would turn this into a module and lose the global effect.

// ─── Asset imports (handled by esbuild loader: 'text') ───────────────────────

declare module "*.csl" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}

// ─── Build-time env stub ──────────────────────────────────────────────────────
// `process.env.API_HOST` is replaced by esbuild `define` at bundle time.
// This declaration keeps the TS checker happy in browser-targeted JS files.

declare const process: {
  env: {
    API_HOST: string;
    [key: string]: string | undefined;
  };
};
