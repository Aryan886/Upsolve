import {
  EditorialCreateSchema,
  MistakeCreateSchema,
  PatternCreateSchema,
  ProblemInputSchema,
  SnippetCreateSchema,
  type NoteType,
  type Platform,
  type ProblemInput,
} from "@cp-notes/shared";

export interface ProblemFields {
  name: string;
  url: string;
  platform: Platform;
  rating: string;
  contestId: string;
  tags: string;
}

export type CaptureFields = Record<string, string>;

export function splitTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

export function optionalProblem(fields: ProblemFields): ProblemInput | undefined {
  const name = fields.name.trim();
  const url = fields.url.trim();
  if (!name && !url) return undefined;
  if (!name || !url) throw new Error("A linked problem needs both a name and URL. Clear both fields to save unlinked.");
  const rating = fields.rating.trim() ? Number(fields.rating) : null;
  return ProblemInputSchema.parse({
    name,
    url,
    platform: fields.platform,
    rating,
    contestId: fields.contestId.trim() || null,
    tags: splitTags(fields.tags),
  });
}

export function buildSubmission(type: NoteType, fields: CaptureFields, problemFields: ProblemFields): unknown {
  const problem = type === "snippet" ? undefined : optionalProblem(problemFields);
  switch (type) {
    case "pattern":
      return PatternCreateSchema.parse({
        trigger: fields.trigger,
        coreIdea: fields.coreIdea,
        complexity: fields.complexity,
        tags: splitTags(fields.tags ?? ""),
        ...(problem ? { problem } : {}),
      });
    case "mistake":
      return MistakeCreateSchema.parse({
        rootCause: fields.rootCause,
        notes: fields.notes,
        contestId: fields.contestId?.trim() || null,
        ...(problem ? { problem } : {}),
      });
    case "snippet":
      return SnippetCreateSchema.parse({
        name: fields.name,
        language: fields.language,
        code: fields.code,
        tags: splitTags(fields.tags ?? ""),
      });
    case "editorial":
      return EditorialCreateSchema.parse({
        oneLiner: fields.oneLiner,
        contestId: fields.contestId?.trim() || null,
        ...(problem ? { problem } : {}),
      });
  }
}
