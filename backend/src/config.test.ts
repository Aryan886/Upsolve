import { expect, it } from "vitest";
import { readConfig } from "./config.js";
it("requires explicit local mode to relax cookies", () => {
  expect(readConfig({}).localDevelopment).toBe(false);
  expect(readConfig({ LOCAL_DEVELOPMENT: "true" }).localDevelopment).toBe(true);
  expect(() => readConfig({ NODE_ENV: "production", LOCAL_DEVELOPMENT: "true" })).toThrow("cannot be enabled");
});
it("rejects invalid ports, origins, extension IDs and session durations", () => {
  for (const environment of [{ PORT: "-1" }, { APP_ORIGIN: "https://notes.test/path" }, { EXTENSION_ORIGINS: "chrome-extension://*" }, { SESSION_DAYS: "NaN" }, { SESSION_DAYS: "1000" }]) expect(() => readConfig(environment)).toThrow();
});
it("requires a pre-existing database in production", () => {
  expect(() => readConfig({ NODE_ENV: "production", APP_ORIGIN: "https://notes.test", EXTENSION_ORIGINS: `chrome-extension://${"a".repeat(32)}`, DATABASE_PATH: "/missing/cp-notes.db" })).toThrow("missing");
});
