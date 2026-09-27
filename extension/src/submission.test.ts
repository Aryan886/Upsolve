import { describe, expect, it } from "vitest";
import { buildSubmission, optionalProblem } from "./submission";

const emptyProblem = { name: "", url: "", platform: "other" as const, rating: "", contestId: "", tags: "" };

describe("extension submissions", () => {
  it("requires name and URL together for a problem link", () => {
    expect(() => optionalProblem({ ...emptyProblem, name: "A problem" })).toThrow(/both a name and URL/i);
    expect(optionalProblem(emptyProblem)).toBeUndefined();
  });

  it("builds and cleans a pattern payload", () => {
    expect(
      buildSubmission(
        "pattern",
        { trigger: " unit weights ", coreIdea: " BFS ", complexity: " O(V+E) ", tags: "graphs, Graphs" },
        emptyProblem,
      ),
    ).toEqual({ trigger: "unit weights", coreIdea: "BFS", complexity: "O(V+E)", tags: ["graphs"] });
  });

  it("rejects empty required note fields", () => {
    expect(() => buildSubmission("editorial", { oneLiner: "", contestId: "" }, emptyProblem)).toThrow();
  });
});
