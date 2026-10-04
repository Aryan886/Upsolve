import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const defaultDatabasePath = fileURLToPath(new URL("../data/cp-notes.db", import.meta.url));
const websiteDirectory = fileURLToPath(new URL("../../website/dist/", import.meta.url));

function integer(value: string | undefined, fallback: number, label: string, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  return parsed;
}

export function readAppOrigin(environment: NodeJS.ProcessEnv): string {
  const production = environment.NODE_ENV === "production";
  if (environment.NODE_ENV && !["development", "production", "test"].includes(environment.NODE_ENV)) throw new Error("NODE_ENV must be development, production or test");
  if (environment.LOCAL_DEVELOPMENT && !["true", "false"].includes(environment.LOCAL_DEVELOPMENT)) throw new Error("LOCAL_DEVELOPMENT must be true or false");
  const localDevelopment = environment.LOCAL_DEVELOPMENT === "true";
  if (production && localDevelopment) throw new Error("LOCAL_DEVELOPMENT cannot be enabled in production");
  const appOrigin = environment.APP_ORIGIN ?? (production ? "" : "http://localhost:5173");
  let url: URL;
  try { url = new URL(appOrigin); } catch { throw new Error("APP_ORIGIN must be a complete website origin"); }
  if (url.origin !== appOrigin || url.username || url.password || (production ? url.protocol !== "https:" : !["http:", "https:"].includes(url.protocol))) {
    throw new Error("APP_ORIGIN must be an origin without path, credentials or trailing slash; production requires HTTPS");
  }
  if (localDevelopment && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Local development requires a loopback APP_ORIGIN");
  return appOrigin;
}

function readLinkOrigin(environment: NodeJS.ProcessEnv): string {
  const appOrigin = readAppOrigin(environment);
  if (new URL(appOrigin).protocol !== "https:" && environment.LOCAL_DEVELOPMENT !== "true") {
    throw new Error("Account setup links require HTTPS, or explicit LOCAL_DEVELOPMENT=true with a loopback APP_ORIGIN");
  }
  return appOrigin;
}

export function readInvitationConfig(environment: NodeJS.ProcessEnv): { appOrigin: string; invitationHours: number } {
  const appOrigin = readLinkOrigin(environment);
  return { appOrigin, invitationHours: integer(environment.INVITATION_HOURS, 72, "INVITATION_HOURS", 168) };
}

export function readBetaSignupConfig(environment: NodeJS.ProcessEnv): { appOrigin: string; betaSignupHours: number } {
  return { appOrigin: readLinkOrigin(environment), betaSignupHours: integer(environment.BETA_SIGNUP_HOURS, 168, "BETA_SIGNUP_HOURS", 168) };
}

export function readConfig(environment: NodeJS.ProcessEnv) {
  const production = environment.NODE_ENV === "production";
  const localDevelopment = environment.LOCAL_DEVELOPMENT === "true";
  const appOrigin = readAppOrigin(environment);
  const extensionOrigins = (environment.EXTENSION_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (extensionOrigins.some((origin) => !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) throw new Error("EXTENSION_ORIGINS must contain comma-separated Chrome extension origins");
  if (production && !extensionOrigins.length) throw new Error("Configure EXTENSION_ORIGINS before production startup");
  if (production && (!environment.DATABASE_PATH || !isAbsolute(environment.DATABASE_PATH))) throw new Error("Production DATABASE_PATH must be an absolute path outside the release");
  const databasePath = resolve(environment.DATABASE_PATH ?? defaultDatabasePath);
  const releaseDirectory = fileURLToPath(new URL("../../", import.meta.url));
  const databaseWithinRelease = relative(releaseDirectory, databasePath);
  if (production && !databaseWithinRelease.startsWith("..") && !isAbsolute(databaseWithinRelease)) throw new Error("Production database must be outside the release directory");
  if (production && !existsSync(databasePath)) throw new Error("Production database is missing. Restore it or explicitly initialize it with the admin command.");
  return {
    port: integer(environment.PORT, 3000, "PORT", 65_535), databasePath,
    websiteOrigins: [appOrigin], extensionOrigins, localDevelopment,
    sessionDays: integer(environment.SESSION_DAYS, 30, "SESSION_DAYS", 90), existingOnly: production,
    ...(production ? { websiteDirectory } : {}),
  };
}
