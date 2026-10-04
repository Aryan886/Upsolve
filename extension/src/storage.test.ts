import { describe, expect, it, vi } from "vitest";
import { DraftStore, draftKey } from "./storage";

function localStorage() {
  const data: Record<string, unknown> = {};
  return { data, get: async (key: string | null) => key === null ? { ...data } : { [key]: data[key] }, set: async (items: Record<string, unknown>) => { Object.assign(data, items); }, remove: async (keys: string | string[]) => { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; } };
}
const draft = { fields: { trigger: "Unsent idea", code: "private code" }, pendingSave: false };

describe("draft recovery", () => {
  it("restores after reopening and separates account, API, problem and note type", async () => {
    const storage = localStorage();
    const key = draftKey("https://a.test/api", 1, "problem", "pattern");
    await new DraftStore(storage).save(key, draft);
    const reopened = new DraftStore(storage);
    expect(await reopened.load(key)).toEqual(draft);
    for (const other of [draftKey("https://b.test/api", 1, "problem", "pattern"), draftKey("https://a.test/api", 2, "problem", "pattern"), draftKey("https://a.test/api", 1, "other", "pattern"), draftKey("https://a.test/api", 1, "problem", "mistake")]) expect(await reopened.load(other)).toBeNull();
  });
  it("queues deletion behind a delayed write so it cannot recreate a saved draft", async () => {
    const storage = localStorage();
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const store = new DraftStore({ ...storage, set: async (items) => { await gate; await storage.set(items); } });
    const save = store.save("key", draft);
    const clear = store.clear("key");
    finish();
    await Promise.all([save, clear]);
    expect(await store.load("key")).toBeNull();
  });
  it("clears only the logged-out account and preserves interrupted-save warnings", async () => {
    const storage = localStorage();
    const store = new DraftStore(storage);
    const keyA = draftKey("https://a.test/api", 1, "problem", "pattern");
    const keyB = draftKey("https://a.test/api", 2, "problem", "pattern");
    await store.save(keyA, draft);
    await store.save(keyB, { ...draft, pendingSave: true });
    await store.clearAccount("https://a.test/api", 1);
    expect(await store.load(keyA)).toBeNull();
    expect((await store.load(keyB))?.pendingSave).toBe(true);
  });
  it("reports storage failures and permits recovery on a subsequent attempt", async () => {
    const storage = localStorage();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = new DraftStore({ ...storage, set: vi.fn().mockRejectedValueOnce(new Error("quota exceeded")).mockImplementation(storage.set) });
    await expect(store.save("key", draft)).rejects.toThrow("quota");
    await store.save("key", draft);
    expect(await store.load("key")).toEqual(draft);
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});
