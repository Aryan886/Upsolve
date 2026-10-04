import { defineConfig, loadEnv } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, resolve(".."), "VITE_"), ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const production = mode === "production";
  const api = environment.VITE_BACKEND_URL ?? (production ? "" : "http://localhost:3000/api");
  const url = new URL(api);
  if (url.pathname !== "/api" || url.search || url.hash || url.username || url.password || (production ? url.protocol !== "https:" : url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("VITE_BACKEND_URL must be an HTTPS origin followed by /api in production, or a loopback HTTP /api in development");
  }
  const feedback = environment.VITE_FEEDBACK_URL ?? "";
  if ((production || feedback) && !/^https:\/\//.test(feedback)) throw new Error("VITE_FEEDBACK_URL must be an HTTPS feedback form for release builds");
  if (production && !/^[a-p]{32}$/.test(environment.VITE_EXTENSION_ID ?? "")) throw new Error("Set the stable VITE_EXTENSION_ID before a production build");
  const manifest = JSON.parse(readFileSync(new URL("./public/manifest.json", import.meta.url), "utf8")) as Record<string, unknown>;
  manifest.host_permissions = production ? [`${url.origin}/*`] : ["http://localhost/*", "http://127.0.0.1/*"];
  if (environment.VITE_EXTENSION_KEY) manifest.key = environment.VITE_EXTENSION_KEY;
  return {
    base: "./", publicDir: false,
    define: { "import.meta.env.VITE_BACKEND_URL": JSON.stringify(api), "import.meta.env.VITE_FEEDBACK_URL": JSON.stringify(feedback) },
    plugins: [{ name: "configured-manifest", generateBundle() { this.emitFile({ type: "asset", fileName: "manifest.json", source: JSON.stringify(manifest, null, 2) });
      for (const size of [16, 32, 48, 128]) this.emitFile({ type: "asset", fileName: `icons/icon-${size}.png`, source: readFileSync(new URL(`./public/icons/icon-${size}.png`, import.meta.url)) });
    } }],
    build: { outDir: "dist", emptyOutDir: true, rollupOptions: { input: "popup.html" } },
  };
});
