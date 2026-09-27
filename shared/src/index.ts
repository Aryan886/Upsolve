import { z } from "zod";

export const PLATFORMS = ["codeforces", "codechef", "atcoder", "other"] as const;
export const ROOT_CAUSES = [
  "misread_constraint",
  "missed_edge_case",
  "wrong_approach",
  "time_management",
  "implementation_bug",
  "other",
] as const;
export const NOTE_TYPES = ["pattern", "mistake", "snippet", "editorial"] as const;

export type Platform = (typeof PLATFORMS)[number];
export type RootCause = (typeof ROOT_CAUSES)[number];
export type NoteType = (typeof NOTE_TYPES)[number];

export const PlatformSchema = z.enum(PLATFORMS);
export const RootCauseSchema = z.enum(ROOT_CAUSES);
export const NoteTypeSchema = z.enum(NOTE_TYPES);

const optionalText = (max = 200) => z.string().trim().max(max).nullable().optional();
const requiredText = (label: string, max = 20_000) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const TagsSchema = z
  .array(z.string().trim().min(1).max(64))
  .max(30)
  .transform((tags) => {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

export const ProblemInputSchema = z.object({
  name: requiredText("Problem name", 300),
  url: z.url({ protocol: /^https?$/, hostname: z.regexes.domain }),
  platform: PlatformSchema,
  rating: z.number().int().nonnegative().nullable().optional(),
  contestId: optionalText(100),
  tags: TagsSchema.nullable().optional(),
});

export const ProblemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  url: z.string(),
  platform: PlatformSchema,
  rating: z.number().int().nullable(),
  contestId: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: z.string(),
});

const linkedCreateFields = {
  problemId: z.number().int().positive().nullable().optional(),
  problem: ProblemInputSchema.optional(),
};

const exactlyOneProblemSource = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, ...linkedCreateFields }).superRefine((value, context) => {
    const linked = value as { problem?: unknown; problemId?: unknown };
    if (linked.problem !== undefined && linked.problemId !== undefined && linked.problemId !== null) {
      context.addIssue({
        code: "custom",
        path: ["problem"],
        message: "Provide either problem or problemId, not both",
      });
    }
  });

export const PatternCreateSchema = exactlyOneProblemSource({
  trigger: requiredText("Trigger"),
  coreIdea: requiredText("Core idea"),
  complexity: requiredText("Complexity", 300),
  tags: TagsSchema.nullable().optional(),
});

export const MistakeCreateSchema = exactlyOneProblemSource({
  contestId: optionalText(100),
  rootCause: RootCauseSchema,
  notes: requiredText("Notes"),
});

export const SnippetCreateSchema = z.object({
  name: requiredText("Snippet name", 300),
  language: requiredText("Language", 50),
  code: z.string().min(1, "Code is required").max(200_000),
  tags: TagsSchema.nullable().optional(),
});

export const EditorialCreateSchema = exactlyOneProblemSource({
  contestId: optionalText(100),
  oneLiner: requiredText("Takeaway", 1_000),
});

const nonEmptyPatch = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).partial().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const PatternPatchSchema = nonEmptyPatch({
  trigger: requiredText("Trigger"),
  coreIdea: requiredText("Core idea"),
  complexity: requiredText("Complexity", 300),
  tags: TagsSchema.nullable(),
  problemId: z.number().int().positive().nullable(),
});

export const MistakePatchSchema = nonEmptyPatch({
  contestId: z.string().trim().max(100).nullable(),
  rootCause: RootCauseSchema,
  notes: requiredText("Notes"),
  problemId: z.number().int().positive().nullable(),
});

export const SnippetPatchSchema = nonEmptyPatch({
  name: requiredText("Snippet name", 300),
  language: requiredText("Language", 50),
  code: z.string().min(1, "Code is required").max(200_000),
  tags: TagsSchema.nullable(),
});

export const EditorialPatchSchema = nonEmptyPatch({
  contestId: z.string().trim().max(100).nullable(),
  oneLiner: requiredText("Takeaway", 1_000),
  problemId: z.number().int().positive().nullable(),
});

export type ProblemInput = z.infer<typeof ProblemInputSchema>;
export type Problem = z.infer<typeof ProblemSchema>;
export type PatternCreate = z.infer<typeof PatternCreateSchema>;
export type MistakeCreate = z.infer<typeof MistakeCreateSchema>;
export type SnippetCreate = z.infer<typeof SnippetCreateSchema>;
export type EditorialCreate = z.infer<typeof EditorialCreateSchema>;
export type PatternPatch = z.infer<typeof PatternPatchSchema>;
export type MistakePatch = z.infer<typeof MistakePatchSchema>;
export type SnippetPatch = z.infer<typeof SnippetPatchSchema>;
export type EditorialPatch = z.infer<typeof EditorialPatchSchema>;

export interface Pattern {
  id: number;
  trigger: string;
  coreIdea: string;
  complexity: string;
  tags: string[];
  problem: Problem | null;
  createdAt: string;
}

export interface Mistake {
  id: number;
  problem: Problem | null;
  contestId: string | null;
  rootCause: RootCause;
  notes: string;
  createdAt: string;
}

export interface Snippet {
  id: number;
  name: string;
  language: string;
  code: string;
  tags: string[];
  createdAt: string;
}

export interface Editorial {
  id: number;
  problem: Problem | null;
  contestId: string | null;
  oneLiner: string;
  createdAt: string;
}

export type NoteRecord = Pattern | Mistake | Snippet | Editorial;

export type FeedItem =
  | { type: "pattern"; record: Pattern }
  | { type: "mistake"; record: Mistake }
  | { type: "snippet"; record: Snippet }
  | { type: "editorial"; record: Editorial };

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: PageMeta;
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface DetectedProblemPage {
  platform: Platform;
  canonicalUrl: string;
  contestId: string | null;
}

function stripTrailingSlash(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

export function detectProblemPage(rawUrl: string): DetectedProblemPage | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLocaleLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "codeforces.com") {
    let contestId: string | undefined;
    let index: string | undefined;
    if (parts[0] === "problemset" && parts[1] === "problem") {
      [, , contestId, index] = parts;
    } else if (parts[0] === "contest" && parts[2] === "problem") {
      [, contestId, , index] = parts;
    } else if (parts[0] === "gym" && parts[2] === "problem") {
      [, contestId, , index] = parts;
      if (contestId && index) {
        return {
          platform: "codeforces",
          canonicalUrl: `https://codeforces.com/gym/${encodeURIComponent(contestId)}/problem/${encodeURIComponent(index)}`,
          contestId,
        };
      }
    }
    if (contestId && index) {
      return {
        platform: "codeforces",
        canonicalUrl: `https://codeforces.com/problemset/problem/${encodeURIComponent(contestId)}/${encodeURIComponent(index)}`,
        contestId,
      };
    }
  }

  if (host === "codechef.com") {
    const problemIndex = parts.lastIndexOf("problems");
    const code = problemIndex >= 0 ? parts[problemIndex + 1] : undefined;
    if (code) {
      const contestId = problemIndex > 0 ? (parts[problemIndex - 1] ?? null) : null;
      return {
        platform: "codechef",
        canonicalUrl: `https://www.codechef.com/problems/${encodeURIComponent(code)}`,
        contestId,
      };
    }
  }

  if (host === "atcoder.jp" && parts[0] === "contests" && parts[2] === "tasks" && parts[1] && parts[3]) {
    return {
      platform: "atcoder",
      canonicalUrl: `https://atcoder.jp/contests/${encodeURIComponent(parts[1])}/tasks/${encodeURIComponent(parts[3])}`,
      contestId: parts[1],
    };
  }

  return null;
}

export function normalizeProblemUrl(rawUrl: string): string {
  const detected = detectProblemPage(rawUrl);
  if (detected) return detected.canonicalUrl;

  const url = new URL(rawUrl);
  url.hash = "";
  url.hostname = url.hostname.toLocaleLowerCase();
  url.pathname = stripTrailingSlash(url.pathname);
  return url.toString();
}

export function isLocalBackendUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function rootCauseLabel(value: RootCause): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}
