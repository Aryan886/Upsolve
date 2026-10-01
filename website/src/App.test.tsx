import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App, { readInvitation } from "./App";
import { acceptInvitation, ApiError, changePassword, getCurrentUser, inspectInvitation, login, logout } from "./api";

vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(),
  getCurrentUser: vi.fn(),
  inspectInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock("./pages/FeedPage", () => ({ FeedPage: () => <p>Private diary</p> }));
vi.mock("./pages/MistakesPage", () => ({ MistakesPage: () => <p>Mistakes</p> }));
vi.mock("./pages/SearchPage", () => ({ SearchPage: () => <p>Search</p> }));

class AccountChannel {
  static channels: AccountChannel[] = [];
  onmessage: (() => void) | null = null;
  closed = false;
  constructor() { AccountChannel.channels.push(this); }
  postMessage(): void {
    for (const channel of [...AccountChannel.channels]) if (channel !== this && !channel.closed) channel.onmessage?.();
  }
  close(): void { this.closed = true; }
  static changed(): void {
    for (const channel of [...this.channels]) if (!channel.closed) channel.onmessage?.();
  }
}

const token = "a".repeat(43);
const invitation = { email: "invited@example.com", expiresAt: "2026-10-01T00:00:00.000Z" };
const firstUser = { id: 1, email: "existing@example.com", createdAt: "2026-09-01T00:00:00.000Z" };
const secondUser = { id: 2, email: "other@example.com", createdAt: "2026-09-01T00:00:00.000Z" };

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", AccountChannel);
  AccountChannel.channels = [];
  vi.mocked(getCurrentUser).mockRejectedValue(new ApiError("session_expired", "Sign in again"));
  vi.mocked(inspectInvitation).mockResolvedValue(invitation);
  window.history.replaceState(null, "", "/");
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

function submitSetup(): void {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long password" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a long password" } });
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
}

it("keeps normal visits on the existing login path", async () => {
  render(<App />);
  await screen.findByRole("button", { name: "Sign in" });
  expect(inspectInvitation).not.toHaveBeenCalled();
  expect(acceptInvitation).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
});

it.each(["/privacy", "/privacy/"])("shows the public policy at %s without checking a session or invitation", (path) => {
  window.history.replaceState(null, "", path);
  render(<App initialInvitation={{ token }} />);
  expect(screen.getByRole("heading", { name: "Privacy policy" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "aryankhade80@gmail.com" })).toHaveAttribute("href", "mailto:aryankhade80@gmail.com");
  expect(screen.getByRole("link", { name: "7219283196" })).toHaveAttribute("href", "tel:7219283196");
  expect(screen.getByRole("link", { name: "Return to CP Notes" })).toHaveAttribute("href", "/");
  expect(getCurrentUser).not.toHaveBeenCalled();
  expect(inspectInvitation).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
});

it("waits until session discovery finishes even after its real 401 event", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  let finishSession: () => void = () => undefined;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
  vi.mocked(getCurrentUser).mockImplementation(async () => {
    try { return await actual.getCurrentUser(); }
    catch (error) { await new Promise<void>((resolve) => { finishSession = resolve; }); throw error; }
  });
  render(<App initialInvitation={{ token }} />);
  await screen.findByText("Sign in to continue.");
  expect(screen.getByText("Checking your session...")).toBeInTheDocument();
  expect(inspectInvitation).not.toHaveBeenCalled();
  await act(async () => { finishSession(); });
  await screen.findByRole("button", { name: "Create account" });
  expect(vi.mocked(inspectInvitation).mock.calls[0]?.[0]).toBe(token);
});

it("retains the startup token through StrictMode without browser storage", async () => {
  const store = vi.spyOn(Storage.prototype, "setItem");
  window.history.replaceState(null, "", `/#invite=${token}`);
  const initialInvitation = readInvitation();
  expect(window.location.hash).toBe("");
  render(<StrictMode><App initialInvitation={initialInvitation} /></StrictMode>);
  await screen.findByRole("button", { name: "Create account" });
  expect(getCurrentUser).toHaveBeenCalledTimes(2);
  expect(vi.mocked(inspectInvitation).mock.calls[0]?.[0]).toBe(token);
  expect(store).not.toHaveBeenCalled();
  expect(readInvitation()).toBeNull();
  store.mockRestore();
});

it("requires explicit logout and keeps the invitation after logout fails", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(firstUser);
  vi.mocked(logout).mockRejectedValueOnce(new Error("Could not sign out"))
    .mockResolvedValueOnce(undefined);
  render(<App initialInvitation={{ token }} />);
  await screen.findByRole("heading", { name: "Set up an invited account" });
  expect(screen.getByText(/Sign out before setting up/)).toHaveTextContent(firstUser.email);
  expect(inspectInvitation).not.toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out");
  expect(screen.getByRole("heading", { name: "Set up an invited account" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("button", { name: "Create account" });
  expect(vi.mocked(inspectInvitation).mock.calls[0]?.[0]).toBe(token);
});

it("lets a signed-in visitor dismiss setup and keep the diary", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(firstUser);
  render(<App initialInvitation={{ token }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Return to diary" }));
  expect(screen.getByText("Private diary")).toBeInTheDocument();
  expect(logout).not.toHaveBeenCalled();
  expect(inspectInvitation).not.toHaveBeenCalled();
});

it("keeps the invitation pending while logout runs and cannot return to the diary mid-request", async () => {
  let finish: () => void = () => undefined;
  vi.mocked(getCurrentUser).mockResolvedValue(firstUser);
  vi.mocked(logout).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<App initialInvitation={{ token }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  const returnButton = screen.getByRole("button", { name: "Return to diary" });
  expect(returnButton).toBeDisabled();
  fireEvent.click(returnButton);
  expect(screen.getByRole("heading", { name: "Set up an invited account" })).toBeInTheDocument();
  expect(screen.queryByText("Private diary")).not.toBeInTheDocument();
  await act(async () => { finish(); });
  await screen.findByRole("button", { name: "Create account" });
  expect(vi.mocked(inspectInvitation).mock.calls[0]?.[0]).toBe(token);
  expect(inspectInvitation).toHaveBeenCalledOnce();
});

it("clears confirmed setup, prefills login, and opens onboarding after normal login", async () => {
  vi.mocked(acceptInvitation).mockResolvedValue({ email: invitation.email });
  vi.mocked(login).mockResolvedValue({ ...secondUser, email: invitation.email });
  render(<App initialInvitation={{ token }} />);
  await screen.findByRole("button", { name: "Create account" });
  submitSetup();
  await screen.findByRole("button", { name: "Sign in" });
  expect(screen.getByRole("status")).toHaveTextContent("Account created. Sign in to continue.");
  expect(screen.getByLabelText("Email")).toHaveValue(invitation.email);
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
  expect(login).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long password" } });
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
  await screen.findByText("Private diary");
  expect(screen.getByText("Start here").closest("details")).toHaveAttribute("open");
  expect(screen.getByText(/same email and password you use here/)).toBeInTheDocument();
  expect(login).toHaveBeenCalledExactlyOnceWith(invitation.email, "a long password");
});

it("offers normal prefilled login after an uncertain acceptance without replaying it", async () => {
  vi.mocked(acceptInvitation).mockRejectedValue(new ApiError("internal_error", "Unknown outcome", undefined, 500));
  render(<App initialInvitation={{ token }} />);
  await screen.findByRole("button", { name: "Create account" });
  submitSetup();
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with the password you just chose" }));
  expect(screen.getByLabelText("Email")).toHaveValue(invitation.email);
  expect(screen.getByRole("status")).toHaveTextContent("Account setup may have completed");
  expect(acceptInvitation).toHaveBeenCalledOnce();
  expect(login).not.toHaveBeenCalled();
});

it("discards delayed inspection when an account broadcast discovers another user", async () => {
  let finish: (value: typeof invitation) => void = () => undefined;
  vi.mocked(inspectInvitation).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<App initialInvitation={{ token }} />);
  await screen.findByText("Checking your invitation...");
  vi.mocked(getCurrentUser).mockResolvedValueOnce(secondUser);
  act(() => { AccountChannel.changed(); });
  await screen.findByText("Private diary");
  await act(async () => { finish(invitation); });
  expect(screen.getByText(secondUser.email)).toBeInTheDocument();
  expect(screen.queryByText(invitation.email)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
});

it("discards delayed acceptance when an account broadcast discovers another user", async () => {
  let finish: (value: { email: string }) => void = () => undefined;
  vi.mocked(acceptInvitation).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<App initialInvitation={{ token }} />);
  await screen.findByRole("button", { name: "Create account" });
  submitSetup();
  vi.mocked(getCurrentUser).mockResolvedValueOnce(secondUser);
  act(() => { AccountChannel.changed(); });
  await screen.findByText("Private diary");
  await act(async () => { finish({ email: invitation.email }); });
  expect(screen.getByText(secondUser.email)).toBeInTheDocument();
  expect(screen.queryByText(/Account created/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
});

it("ignores delayed login after an external account change", async () => {
  let finish: (value: typeof firstUser) => void = () => undefined;
  vi.mocked(login).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<App />);
  await screen.findByRole("button", { name: "Sign in" });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: firstUser.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long password" } });
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
  vi.mocked(getCurrentUser).mockResolvedValueOnce(secondUser);
  act(() => { AccountChannel.changed(); });
  await screen.findByText("Private diary");
  await act(async () => { finish(firstUser); });
  expect(screen.getByText(secondUser.email)).toBeInTheDocument();
  expect(screen.queryByText(firstUser.email)).not.toBeInTheDocument();
});

it("preserves setup through a failed session check and explicit retry", async () => {
  vi.mocked(getCurrentUser).mockRejectedValueOnce(new Error("Unavailable"))
    .mockRejectedValueOnce(new ApiError("session_expired", "Sign in again"));
  render(<App initialInvitation={{ token }} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  expect(inspectInvitation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Create account" });
  expect(vi.mocked(inspectInvitation).mock.calls[0]?.[0]).toBe(token);
});

it("keeps session expiry on the ordinary auth flow", async () => {
  vi.mocked(getCurrentUser).mockResolvedValueOnce(firstUser);
  render(<App />);
  await screen.findByText("Private diary");
  act(() => { window.dispatchEvent(new Event("cp-notes-session-expired")); });
  await screen.findByRole("button", { name: "Sign in" });
  expect(screen.queryByText("Private diary")).not.toBeInTheDocument();
  expect(inspectInvitation).not.toHaveBeenCalled();
});

it("requires normal sign-in after a successful password change", async () => {
  vi.mocked(getCurrentUser).mockResolvedValueOnce(firstUser);
  vi.mocked(changePassword).mockResolvedValueOnce(undefined);
  render(<App />);
  await screen.findByText("Private diary");
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current password" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a new password" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "a new password" } });
  fireEvent.submit(screen.getByRole("button", { name: "Change password" }).closest("form")!);
  await screen.findByRole("button", { name: "Sign in" });
  expect(screen.getByRole("status")).toHaveTextContent("Password changed. Sign in again on each device.");
  expect(changePassword).toHaveBeenCalledExactlyOnceWith("current password", "a new password");
  expect(screen.queryByText("Private diary")).not.toBeInTheDocument();
  expect(inspectInvitation).not.toHaveBeenCalled();
});
