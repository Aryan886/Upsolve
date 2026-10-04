import { beforeEach, describe, expect, it } from "vitest";
import { cleanPageTitle, scrapeDocument } from "./scraper";

describe("problem-page scraping", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("uses a Codeforces problem title selector", () => {
    document.body.innerHTML = '<div class="problem-statement"><div class="title">A. Theatre Square</div></div>';
    expect(scrapeDocument("codeforces")).toBe("A. Theatre Square");
  });

  it("falls back to and cleans the page title", () => {
    document.title = "B - AtCoder Beginner Contest 100 - AtCoder";
    expect(cleanPageTitle(scrapeDocument("atcoder"), "atcoder")).toBe("B - AtCoder Beginner Contest 100");
  });
});


it("extracts and cleans the visible LeetCode title", () => {
  document.body.innerHTML = '<a class="text-title-large" href="/problems/two-sum/">1. Two Sum</a>';
  expect(cleanPageTitle(scrapeDocument("leetcode"), "leetcode")).toBe("1. Two Sum");
  document.body.innerHTML = "";
  document.title = "Two Sum - LeetCode";
  expect(cleanPageTitle(scrapeDocument("leetcode"), "leetcode")).toBe("Two Sum");
  document.title = "";
  expect(scrapeDocument("leetcode")).toBe("");
});
