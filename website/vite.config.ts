import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import packageInfo from "./package.json" with { type: "json" };

export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, resolve(".."), "VITE_"), ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const feedback = environment.VITE_FEEDBACK_URL ?? "";
  const install = environment.VITE_EXTENSION_INSTALL_URL ?? "";
  if ((mode === "production" || feedback) && !/^https:\/\//.test(feedback)) throw new Error("Set an HTTPS VITE_FEEDBACK_URL for release builds");
  if (install && !/^https:\/\//.test(install)) throw new Error("VITE_EXTENSION_INSTALL_URL must use HTTPS");
  if (environment.VITE_API_BASE_URL && environment.VITE_API_BASE_URL !== "/api") throw new Error("The website uses the same-origin /api endpoint");
  return {
    plugins: [react()],
    define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/api"), "import.meta.env.VITE_FEEDBACK_URL": JSON.stringify(feedback), "import.meta.env.VITE_EXTENSION_INSTALL_URL": JSON.stringify(install), "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageInfo.version) },
    server: { host: "127.0.0.1", port: 5173, proxy: { "/api": "http://127.0.0.1:3000" } },
  };
});
