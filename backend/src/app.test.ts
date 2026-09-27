import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";

describe("CP Notes API", () => {
  let app: Express;
  let close: () => void;

  beforeEach(() => {
    const context = createApp({ databasePath: ":memory:" });
    app = context.app;
    close = context.close;
  });

  afterEach(() => close());

  it("atomically creates a note and deduplicates its canonical problem URL", async () => {
    const first = await request(app)
      .post("/patterns")
      .send({
        trigger: "Shortest path with unit weights",
        coreIdea: "Use BFS",
        complexity: "O(V + E)",
        tags: ["graphs", "Graphs"],
        problem: {
          name: "A. Example",
          url: "https://codeforces.com/contest/123/problem/A?locale=en",
          platform: "codeforces",
          contestId: "123",
        },
      })
      .expect(201);

    const second = await request(app)
      .post("/editorial")
      .send({
        oneLiner: "The graph is implicitly unweighted.",
        problem: {
          name: "Duplicate title is ignored",
          url: "https://codeforces.com/problemset/problem/123/A",
          platform: "codeforces",
          rating: 1200,
        },
      })
      .expect(201);

    expect(first.body.data.problem.id).toBe(second.body.data.problem.id);
    expect(second.body.data.problem.name).toBe("A. Example");
    expect(second.body.data.problem.rating).toBe(1200);

    const problems = await request(app).get("/problems").expect(200);
    expect(problems.body.meta.total).toBe(1);
  });

  it("filters, counts, edits, unlinks, and deletes mistakes without deleting problems", async () => {
    const created = await request(app)
      .post("/mistakes")
      .send({
        rootCause: "missed_edge_case",
        notes: "Forgot n = 1",
        problem: {
          name: "Edge case",
          url: "https://atcoder.jp/contests/abc100/tasks/abc100_a",
          platform: "atcoder",
        },
      })
      .expect(201);

    await request(app)
      .post("/mistakes")
      .send({ rootCause: "time_management", notes: "Spent too long debugging" })
      .expect(201);

    const filtered = await request(app).get("/mistakes?rootCause=missed_edge_case").expect(200);
    expect(filtered.body.data).toHaveLength(1);

    const stats = await request(app).get("/mistakes/stats").expect(200);
    expect(stats.body.data.missed_edge_case).toBe(1);
    expect(stats.body.data.other).toBe(0);

    const id = created.body.data.id as number;
    const updated = await request(app)
      .patch(`/mistakes/${id}`)
      .send({ notes: "Forgot the single-element case", problemId: null })
      .expect(200);
    expect(updated.body.data.problem).toBeNull();

    await request(app).delete(`/mistakes/${id}`).expect(204);
    const problems = await request(app).get("/problems").expect(200);
    expect(problems.body.meta.total).toBe(1);
  });

  it("orders and filters the combined feed", async () => {
    await request(app).post("/snippets").send({ name: "DSU", language: "cpp", code: "struct DSU {};" });
    await request(app)
      .post("/patterns")
      .send({ trigger: "Connectivity queries", coreIdea: "Use DSU", complexity: "Inverse Ackermann" });

    const feed = await request(app).get("/feed?types=pattern&limit=1").expect(200);
    expect(feed.body.data).toHaveLength(1);
    expect(feed.body.data[0].type).toBe("pattern");
    expect(feed.body.meta.total).toBe(1);
  });

  it("returns actionable validation and range errors", async () => {
    const invalid = await request(app).post("/patterns").send({ trigger: "", coreIdea: "x", complexity: "O(1)" }).expect(400);
    expect(invalid.body.error.code).toBe("validation_error");

    const range = await request(app).get("/feed?from=2026-02-01&to=2026-01-01").expect(400);
    expect(range.body.error.code).toBe("invalid_date_range");
  });
});
