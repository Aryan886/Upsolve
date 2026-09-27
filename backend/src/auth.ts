import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { ChangePasswordSchema, LoginSchema, PasswordSchema, type User } from "@cp-notes/shared";
import type { NotesDatabase } from "./database.js";
import { AppError } from "./errors.js";

// OWASP's 32 MiB scrypt profile; two concurrent jobs fit the small beta server.
const cost = { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
let passwordJobs = 0;

async function derivePassword(password: string, salt: string): Promise<Buffer> {
  if (passwordJobs >= 2) throw new AppError(429, "auth_busy", "Sign-in is busy. Try again shortly.");
  passwordJobs += 1;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, cost, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally {
    passwordJobs -= 1;
  }
}

export async function hashPassword(password: string): Promise<string> {
  PasswordSchema.parse(password);
  const salt = randomBytes(16).toString("hex");
  const key = await derivePassword(password, salt);
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const parts = stored?.split("$");
  if (parts && (parts.length !== 6 || parts[0] !== "scrypt" || Number(parts[1]) !== cost.N || Number(parts[2]) !== cost.r || Number(parts[3]) !== cost.p || !/^[a-f0-9]{32}$/.test(parts[4] ?? "") || !/^[a-f0-9]{128}$/.test(parts[5] ?? ""))) {
    throw new Error("Stored password hash has unsupported parameters or an invalid format");
  }
  if (password.length > 128) return false;
  const key = await derivePassword(password, parts?.[4] ?? "00000000000000000000000000000000");
  const expected = parts?.[5] ? Buffer.from(parts[5], "hex") : Buffer.alloc(64);
  return timingSafeEqual(key, expected) && stored !== undefined;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AuthOptions {
  websiteOrigins: string[];
  extensionOrigins: string[];
  localDevelopment?: boolean;
  sessionDays?: number;
}

interface Session {
  user: User;
  tokenHash: string;
  client: "website" | "extension";
}

function credentials(request: Request, cookieName: string): { token: string; client: Session["client"] } {
  const authorization = request.get("authorization");
  if (authorization !== undefined) {
    return { token: /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1] ?? "", client: "extension" };
  }
  const cookie = request.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  return { token: cookie?.slice(cookieName.length + 1) ?? "", client: "website" };
}

export function createAuth(database: NotesDatabase, options: AuthOptions) {
  const router = Router();
  const cookieName = options.localDevelopment ? "cp_notes_dev" : "__Host-cp_notes";
  const cookieOptions = { httpOnly: true, secure: !options.localDevelopment, sameSite: "lax" as const, path: "/" };
  const lifetime = (options.sessionDays ?? 30) * 86_400_000;
  const attempts = new Map<string, { count: number; until: number }>();

  function throttle(key: string, limit: number): void {
    const now = Date.now();
    for (const [entry, value] of attempts) if (value.until <= now) attempts.delete(entry);
    const attempt = attempts.get(key) ?? { count: 0, until: now + 15 * 60_000 };
    if (attempt.count >= limit || (!attempts.has(key) && attempts.size >= 10_000)) {
      throw new AppError(429, "too_many_attempts", "Too many sign-in attempts. Try again in 15 minutes.");
    }
    attempt.count += 1;
    attempts.set(key, attempt);
  }

  function requireWebsiteOrigin(request: Request): void {
    if (!options.websiteOrigins.includes(request.get("origin") ?? "")) {
      throw new AppError(403, "origin_not_allowed", "Open CP Notes from its configured website and try again.");
    }
  }

  function session(request: Request): Session {
    const { token, client } = credentials(request, cookieName);
    const tokenHash = hashToken(token);
    const user = /^[A-Za-z0-9_-]{43}$/.test(token) ? database.getSession(tokenHash, client) : null;
    if (!user) throw new AppError(401, "session_expired", "Sign in to continue. Your unsent entry is still saved locally.");
    if (client === "website" && !["GET", "HEAD", "OPTIONS"].includes(request.method)) requireWebsiteOrigin(request);
    return { user, tokenHash, client };
  }

  async function login(request: Request, response: Response, client: Session["client"]): Promise<void> {
    if (client === "website") requireWebsiteOrigin(request);
    else if (request.get("origin") && !options.extensionOrigins.includes(request.get("origin")!)) {
      throw new AppError(403, "origin_not_allowed", "This extension is not configured for CP Notes.");
    }
    throttle(`ip:${request.ip ?? "unknown"}`, 40);
    const input = LoginSchema.parse(request.body);
    throttle(`account:${input.email}`, 10);
    const user = database.getUserByEmail(input.email);
    const valid = await verifyPassword(input.password, user?.passwordHash);
    if (!valid || !user?.active) throw new AppError(401, "invalid_credentials", "Email or password is incorrect");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + lifetime).toISOString();
    database.createSession(user.id, user.passwordHash, hashToken(token), client, expiresAt);
    const safeUser: User = { id: user.id, email: user.email, createdAt: user.createdAt };
    if (client === "website") response.cookie(cookieName, token, { ...cookieOptions, maxAge: lifetime });
    response.json({ data: client === "website" ? safeUser : { user: safeUser, token, expiresAt } });
  }

  router.post("/login", (request, response) => login(request, response, "website"));
  router.post("/extension-login", (request, response) => login(request, response, "extension"));
  router.get("/me", (request, response) => response.json({ data: session(request).user }));
  router.post("/logout", (request, response) => {
    const current = session(request);
    database.revokeSession(current.tokenHash);
    if (current.client === "website") response.clearCookie(cookieName, cookieOptions);
    response.status(204).end();
  });
  router.post("/change-password", async (request, response) => {
    const current = session(request);
    throttle(`change:${current.user.id}`, 10);
    const input = ChangePasswordSchema.parse(request.body);
    const user = database.getUserByEmail(current.user.email);
    if (!user || !await verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new AppError(400, "incorrect_password", "Current password is incorrect");
    }
    const passwordHash = await hashPassword(input.newPassword);
    session(request); // A reset, logout, or disable may have happened during hashing.
    database.setPassword(user.id, passwordHash, user.passwordHash);
    if (current.client === "website") response.clearCookie(cookieName, cookieOptions);
    response.status(204).end();
  });

  return { router, session };
}
