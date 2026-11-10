// The esbuild options every browser bundle shares (ADR 0015 decision 1; ADR 0025 decision 2): one IIFE, no runtime
// import(), no plugin. JSX is esbuild's built-in transform, the automatic runtime with `preact` as the import source,
// which is what `tsconfig.editor-ui.json` tells `tsc -b` (`jsx: react-jsx`, `jsxImportSource: preact`); the toolchain
// test fails if the two drift. The options only matter for `.tsx` files; other entries are unaffected.
export const bundleOptions = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  logLevel: "warning",
  jsx: "automatic",
  jsxImportSource: "preact",
};
