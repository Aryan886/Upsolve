import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const databasePath = process.env.DATABASE_PATH ?? resolve("data", "cp-notes.db");
mkdirSync(dirname(databasePath), { recursive: true });

const { app, close } = createApp({ databasePath });
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`CP Notes backend listening at http://localhost:${port}`);
  console.log(`SQLite database: ${databasePath}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; closing CP Notes backend`);
  server.close((error) => {
    if (error) {
      console.error("Failed to close HTTP server cleanly:", error);
      process.exitCode = 1;
    }
    close();
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
