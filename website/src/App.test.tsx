import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App, { readSignupLink } from "./App";
import { createAccount, acceptInvitation, ApiError, changePassword, getCurrentUser, inspectInvitation, login, logout } from "./api";

vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(),
  getCurrentUser: vi.fn(),
  inspectInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
  createAccount: vi.fn(),
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
  expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/signup");
});

it("takes public signup through normal login and onboarding", async () => {
  vi.mocked(createAccount).mockResolvedValue({ email: "tester@example.com" });
  vi.mocked(login).mockResolvedValue({ ...secondUser, email: "tester@example.com" });
  render(<App initialSignup={{ kind: "public" }} />);
  await screen.findByRole("button", { name: "Create account" });
  expect(inspectInvitation).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Tester@Example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long password" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a long password" } });
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
  await screen.findByRole("button", { name: "Sign in" });
  expect(screen.getByLabelText("Email")).toHaveValue("tester@example.com");
  expect(window.location.pathname).toBe("/");
  expect(createAccount).toHaveBeenCalledExactlyOnceWith("tester@example.com", "a long password", expect.any(AbortSignal));
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long password" } });
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
  await screen.findByText("Private diary");
  expect(screen.getByText("Start here").closest("details")).toHaveAttribute("open");
});

it.each(["/signup", "/signup/"])("opens direct %s after session discovery and offers ordinary login", async (path) => {
  window.history.replaceState(null, "", path);
  render(<App />);
  expect(screen.getByText("Checking your session...")).toBeInTheDocument();
  expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
  await screen.findByLabelText("Confirm password");
  expect(inspectInvitation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(window.location.pathname).toBe("/");
  expect(screen.getByRole("heading", { name: "Sign in to your diary" })).toBeInTheDocument();
});

it("blocks public signup after an unexpected session failure until explicit recovery", async () => {
  vi.mocked(getCurrentUser).mockRejectedValueOnce(new Error("Session check unavailable"))
    .mockRejectedValueOnce(new ApiError("session_expired", "Sign in again"));
  window.history.replaceState(null, "", "/signup");
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Session check unavailable");
  expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
  expect(createAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByLabelText("Confirm password");
});

it("waits for a real initial 401 to finish cancellation before activating public signup in StrictMode", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
  vi.mocked(getCurrentUser).mockImplementation(actual.getCurrentUser);
  window.history.replaceState(null, "", "/signup");
  render(<StrictMode><App /></StrictMode>);
  await screen.findByLabelText("Confirm password");
  expect(getCurrentUser).toHaveBeenCalledTimes(2);
  expect(createAccount).not.toHaveBeenCalled();
});

it("keeps URL and UI together on Back/Forward, privacy navigation and success", async () => {
  render(<App />);
  await screen.findByRole("button", { name: "Sign in" });
  function navigate(path: string): void {
    act(() => {
      window.history.pushState(null, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  }
  navigate("/signup/");
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tester@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "unsent password" } });
  navigate("/");
  expect(screen.getByRole("heading", { name: "Sign in to your diary" })).toBeInTheDocument();
  navigate("/signup");
  expect(screen.getByLabelText("Password")).toHaveValue("");
  navigate("/privacy/");
  expect(screen.getByRole("heading", { name: "Privacy policy" })).toBeInTheDocument();
  navigate("/signup");
  await screen.findByLabelText("Confirm password");
});

it("preserves a signed-in identity on public signup and after failed logout", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(firstUser);
  vi.mocked(logout).mockRejectedValue(new Error("Sign-out unavailable"));
  window.history.replaceState(null, "", "/signup");
  render(<App />);
  await screen.findByRole("button", { name: "Open diary" });
  expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign-out unavailable");
  expect(screen.getByText(/Sign out before setting up/)).toHaveTextContent(firstUser.email);
  expect(createAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open diary" }));
  expect(screen.getByText("Private diary")).toBeInTheDocument();
  expect(window.location.pathname).toBe("/");
});

it.each(["login", "logout"])("ignores late public signup after another tab's %s", async (change) => {
  let finish: (result: { email: string }) => void = () => undefined;
  vi.mocked(createAccount).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  window.history.replaceState(null, "", "/signup");
  render(<App />);
  await screen.findByLabelText("Confirm password");
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tester@example.com" } });
  submitSetup();
  const signal = vi.mocked(createAccount).mock.calls[0]?.[2];
  if (change === "login") vi.mocked(getCurrentUser).mockResolvedValueOnce(secondUser);
  act(() => { AccountChannel.changed(); });
  if (change === "login") await screen.findByText("Private diary");
  else await screen.findByRole("button", { name: "Sign in" });
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish({ email: "tester@example.com" }); });
  expect(screen.queryByText(/Account created/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("tester@example.com")).not.toBeInTheDocument();
});

it("keeps confirmed creation separate from a subsequent failed login", async () => {
  vi.mocked(createAccount).mockResolvedValue({ email: "tester@example.com" });
  vi.mocked(login).mockRejectedValue(new Error("Sign-in unavailable"));
  window.history.replaceState(null, "", "/signup");
  render(<App />);
  await screen.findByLabelText("Confirm password");
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tester@example.com" } });
  submitSetup();
  await screen.findByRole("button", { name: "Sign in" });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long password" } });
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in unavailable");
  expect(screen.getByRole("status")).toHaveTextContent("Account created. Sign in to continue.");
  expect(createAccount).toHaveBeenCalledOnce();
});

it.each(["/privacy", "/privacy/"])("shows the public policy at %s without checking a session or invitation", (path) => {
  window.history.replaceState(null, "", path);
  render(<App initialSignup={{ kind: "invitation", token }} />);
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
  render(<App initialSignup={{ kind: "invitation", token }} />);
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
  const initialSignup = readSignupLink();
  expect(window.location.hash).toBe("");
  render(<StrictMode><App initialSignup={initialSignup} /></StrictMode>);
  await screen.findByRole("button", { name: "Create account" });
  expect(getCurrentUser).toHaveBeenCalledTimes(2);
  expect(vi.mocked(inspectInvitation).mock.calls[0]?.[0]).toBe(token);
  expect(store).not.toHaveBeenCalled();
  expect(readSignupLink()).toBeNull();
  store.mockRestore();
});

it("requires explicit logout and keeps the invitation after logout fails", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(firstUser);
  vi.mocked(logout).mockRejectedValueOnce(new Error("Could not sign out"))
    .mockResolvedValueOnce(undefined);
  render(<App initialSignup={{ kind: "invitation", token }} />);
  await screen.findByRole("heading", { name: "Set up another account" });
  expect(screen.getByText(/Sign out before setting up/)).toHaveTextContent(firstUser.email);
  expect(inspectInvitation).not.toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out");
  expect(screen.getByRole("heading", { name: "Set up another account" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("button", { name: "Create account" });
  expect(vi.mocked(inspectInvitation).mock.calls[0]?.[0]).toBe(token);
});

it("lets a signed-in visitor dismiss setup and keep the diary", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(firstUser);
  render(<App initialSignup={{ kind: "invitation", token }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Return to diary" }));
  expect(screen.getByText("Private diary")).toBeInTheDocument();
  expect(logout).not.toHaveBeenCalled();
  expect(inspectInvitation).not.toHaveBeenCalled();
});

it("keeps the invitation pending while logout runs and cannot return to the diary mid-request", async () => {
  let finish: () => void = () => undefined;
  vi.mocked(getCurrentUser).mockResolvedValue(firstUser);
  vi.mocked(logout).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<App initialSignup={{ kind: "invitation", token }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  const returnButton = screen.getByRole("button", { name: "Return to diary" });
  expect(returnButton).toBeDisabled();
  fireEvent.click(returnButton);
  expect(screen.getByRole("heading", { name: "Set up another account" })).toBeInTheDocument();
  expect(screen.queryByText("Private diary")).not.toBeInTheDocument();
  await act(async () => { finish(); });
  await screen.findByRole("button", { name: "Create account" });
  expect(vi.mocked(inspectInvitation).mock.calls[0]?.[0]).toBe(token);
  expect(inspectInvitation).toHaveBeenCalledOnce();
});

it("clears confirmed setup, prefills login, and opens onboarding after normal login", async () => {
  vi.mocked(acceptInvitation).mockResolvedValue({ email: invitation.email });
  vi.mocked(login).mockResolvedValue({ ...secondUser, email: invitation.email });
  render(<App initialSignup={{ kind: "invitation", token }} />);
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
  render(<App initialSignup={{ kind: "invitation", token }} />);
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
  render(<App initialSignup={{ kind: "invitation", token }} />);
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
  render(<App initialSignup={{ kind: "invitation", token }} />);
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
  render(<App initialSignup={{ kind: "invitation", token }} />);
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
