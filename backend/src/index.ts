import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig(process.env);
if (!config.existingOnly) mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
const { app, close } = createApp(config);
const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`CP Notes listening on loopback port ${config.port}; schema 2`);
});
server.on("error", (error) => {
  console.error("HTTP server failed:", error.message);
  close();
  process.exitCode = 1;
});
let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; finishing active requests`);
  const timeout = setTimeout(() => server.closeAllConnections(), 15_000);
  timeout.unref();
  server.close((error) => {
    clearTimeout(timeout);
    if (error) { console.error("HTTP shutdown failed:", error.message); process.exitCode = 1; }
    close();
  });
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
