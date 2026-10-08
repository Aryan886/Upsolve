import { expect, it } from "vitest";
import { readConfig, readInvitationConfig } from "./config.js";
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

it("uses a bounded invitation lifetime without requiring unrelated runtime settings", () => {
  const environment = { NODE_ENV: "production", APP_ORIGIN: "https://notes.test" };
  expect(readInvitationConfig(environment)).toEqual({ appOrigin: "https://notes.test", invitationHours: 72 });
  expect(readInvitationConfig({ ...environment, INVITATION_HOURS: "1" }).invitationHours).toBe(1);
  expect(readInvitationConfig({ ...environment, INVITATION_HOURS: "168" }).invitationHours).toBe(168);
  for (const value of ["0", "169", "-1", "1.5", "NaN", ""]) {
    expect(() => readInvitationConfig({ ...environment, INVITATION_HOURS: value })).toThrow("INVITATION_HOURS");
  }
});

it("requires HTTPS invitation links unless explicit loopback development is enabled", () => {
  expect(readInvitationConfig({ LOCAL_DEVELOPMENT: "true" }).appOrigin).toBe("http://localhost:5173");
  expect(readInvitationConfig({ LOCAL_DEVELOPMENT: "true", APP_ORIGIN: "http://127.0.0.1:5173" }).appOrigin).toBe("http://127.0.0.1:5173");
  expect(() => readInvitationConfig({})).toThrow("require HTTPS");
  for (const environment of [
    { APP_ORIGIN: "http://notes.test" },
    { APP_ORIGIN: "http://localhost:5173" },
    { LOCAL_DEVELOPMENT: "true", APP_ORIGIN: "http://notes.test" },
    { NODE_ENV: "production", APP_ORIGIN: "http://localhost:5173" },
    { NODE_ENV: "production", LOCAL_DEVELOPMENT: "true", APP_ORIGIN: "https://localhost" },
    { NODE_ENV: "production" },
    { NODE_ENV: "unknown", APP_ORIGIN: "https://notes.test" },
    { LOCAL_DEVELOPMENT: "yes", APP_ORIGIN: "https://notes.test" },
  ]) expect(() => readInvitationConfig(environment)).toThrow();
});

it("keeps invitation origins free of paths, credentials, queries and fragments", () => {
  for (const appOrigin of [
    "https://notes.test/", "https://notes.test/path", "https://notes.test?next=other",
    "https://notes.test#invite=value", "https://user:password@notes.test", "ftp://notes.test", "not a URL",
  ]) expect(() => readInvitationConfig({ APP_ORIGIN: appOrigin })).toThrow("APP_ORIGIN");
});
