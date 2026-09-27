import { z } from "zod";
import { UserSchema, type NoteType } from "@cp-notes/shared";

export const SessionSchema = z.object({ user: UserSchema, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.iso.datetime() });
export type Session = z.infer<typeof SessionSchema>;
const DraftSchema = z.object({ fields: z.record(z.string(), z.string().max(210_000)), pendingSave: z.boolean() });
export type Draft = z.infer<typeof DraftSchema>;

interface LocalStorage {
  get(keys: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export function draftPrefix(api: string, userId: number): string {
  return `draft:${encodeURIComponent(api)}:${userId}:`;
}

export function draftKey(api: string, userId: number, problem: string, type: NoteType): string {
  return `${draftPrefix(api, userId)}${encodeURIComponent(problem)}:${type}`;
}

export class DraftStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly storage: LocalStorage) {}

  private enqueue(write: () => Promise<void>): Promise<void> {
    const result = this.pending.then(write);
    this.pending = result.catch(() => { console.warn("CP Notes draft storage operation failed; the popup will show recovery instructions."); });
    return result;
  }

  async load(key: string): Promise<Draft | null> {
    await this.pending;
    const stored = (await this.storage.get(key))[key];
    if (stored === undefined) return null;
    const result = DraftSchema.safeParse(stored);
    if (!result.success) throw new Error("This saved draft could not be read. Contact the beta organizer before discarding it.");
    return result.data;
  }

  save(key: string, draft: Draft): Promise<void> {
    return this.enqueue(() => this.storage.set({ [key]: draft }));
  }

  clear(key: string): Promise<void> {
    return this.enqueue(() => this.storage.remove(key));
  }

  clearAccount(api: string, userId: number): Promise<void> {
    return this.enqueue(async () => {
      const entries = await this.storage.get(null);
      const keys = Object.keys(entries).filter((key) => key.startsWith(draftPrefix(api, userId)));
      if (keys.length) await this.storage.remove(keys);
    });
  }
}
