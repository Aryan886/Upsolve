import { detectProblemPage, type DetectedProblemPage, type Platform } from "@cp-notes/shared";

export interface ActiveProblemContext extends DetectedProblemPage {
  name: string;
}

export function cleanPageTitle(title: string, platform: Platform): string {
  const suffixes: Record<Platform, RegExp[]> = {
    codeforces: [/\s*[-–—]\s*Codeforces\s*$/i],
    codechef: [/\s*[-–—|]\s*CodeChef\s*$/i],
    atcoder: [/\s*[-–—]\s*AtCoder\s*$/i],
    leetcode: [/\s*[-??|]\s*LeetCode\s*$/i],
    other: [],
  };
  return suffixes[platform].reduce((value, suffix) => value.replace(suffix, ""), title).trim();
}

// This function is intentionally self-contained because Chrome serializes it into the active page.
export function scrapeDocument(platform: Platform): string {
  const selectors: Record<Platform, string[]> = {
    codeforces: [".problem-statement .title", ".problem-statement .header .title"],
    codechef: ["h1[data-testid='problem-title']", ".problem-statement h1", "h1"],
    atcoder: ["#task-statement + *", "span.h2", ".h2"],
    leetcode: ['a[href^="/problems/"][class*="text-title"]', '[data-cy="question-title"]', "h1"],
    other: ["h1"],
  };
  for (const selector of selectors[platform]) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  return document.title.trim();
}

export async function getActiveProblemContext(): Promise<ActiveProblemContext | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return null;
  const detected = detectProblemPage(tab.url);
  if (!detected) return null;

  let rawName = "";
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeDocument,
      args: [detected.platform],
    });
    rawName = typeof injection?.result === "string" ? injection.result : "";
  } catch (error) {
    console.warn("CP Notes could not inspect the active problem page:", error);
    rawName = tab.title ?? "";
  }

  return { ...detected, name: cleanPageTitle(rawName || tab.title || "", detected.platform) };
}
