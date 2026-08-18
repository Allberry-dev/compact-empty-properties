import esbuild from "esbuild";
import { builtinModules } from "node:module";

const production = process.argv.includes("--production");

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", ...builtinModules],
  format: "cjs",
  target: "es2018",
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info",
  outfile: "main.js"
});
