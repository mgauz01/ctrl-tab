import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  format: "esm",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
};

const ctx = await esbuild.context({
  ...shared,
  entryPoints: {
    background: "src/background/service-worker.ts",
    overlay: "src/overlay/overlay.ts",
    fallback: "src/fallback/fallback.ts",
  },
  outdir: "dist",
});

function copyAssets() {
  mkdirSync(join(__dirname, "dist"), { recursive: true });
  copyFileSync(
    join(__dirname, "src/overlay/overlay.css"),
    join(__dirname, "dist/overlay.css")
  );
  copyFileSync(
    join(__dirname, "src/fallback/fallback.html"),
    join(__dirname, "dist/fallback.html")
  );
}

if (watch) {
  await ctx.watch();
  copyAssets();
  console.log("watching...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  copyAssets();
  console.log("build complete");
}
