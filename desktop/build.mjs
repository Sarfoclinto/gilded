// Bundles the desktop app's main process and preload into dist/. Bundling (instead of plain tsc) lets the app use the shared
// @gold/core package, which is TypeScript source, so the drawer rules in the branch hub are the same code the screens use.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts", "src/preload.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "electron-updater"],
  sourcemap: true,
  logLevel: "info",
});
