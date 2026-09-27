import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteCard } from "./NoteCard";

describe("NoteCard", () => {
  it("shows a clipboard error without swallowing it", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(
      <NoteCard
        type="snippet"
        record={{ id: 1, name: "DSU", language: "cpp", code: "struct DSU {};", tags: [], createdAt: "2026-09-12T00:00:00.000Z" }}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
  });
});
