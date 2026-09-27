import type { NoteRecord, NoteType, Problem } from "@cp-notes/shared";

export function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

export function localDateBoundary(date: string, endOfDay: boolean): string | undefined {
  if (!date) return undefined;
  const [yearText, monthText, dayText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).toISOString();
}

export function noteProblem(type: NoteType, record: NoteRecord): Problem | null {
  return type === "snippet" ? null : (record as Exclude<NoteRecord, { code: string }>).problem;
}

export function noteTags(record: NoteRecord): string[] {
  return "tags" in record ? record.tags : [];
}
