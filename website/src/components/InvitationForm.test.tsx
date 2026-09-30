import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { INVITATION_INVALID_MESSAGE } from "@cp-notes/shared";
import { acceptInvitation, ApiError, inspectInvitation } from "../api";
import { InvitationForm } from "./InvitationForm";

vi.mock("../api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api")>(),
  inspectInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}));

const token = "a".repeat(43);
const invitation = { email: "tester@example.com", expiresAt: "2026-10-01T00:00:00.000Z" };
beforeEach(() => { vi.mocked(inspectInvitation).mockResolvedValue(invitation); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function fillPassword(password = "a long password", confirmation = password): void {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirmation } });
}

async function showForm(onAccepted = vi.fn(), onSignIn = vi.fn()) {
  const view = render(<InvitationForm entry={{ token }} onAccepted={onAccepted} onSignIn={onSignIn} />);
  await screen.findByRole("button", { name: "Create account" });
  return view;
}

it("inspects before showing fixed email and labeled new-password controls", async () => {
  let finish: (value: typeof invitation) => void = () => undefined;
  vi.mocked(inspectInvitation).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<InvitationForm entry={{ token }} onAccepted={vi.fn()} onSignIn={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("Checking your invitation");
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  await act(async () => { finish(invitation); });
  expect(screen.getByText(invitation.email)).toBeInTheDocument();
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByLabelText("Confirm password")).toHaveAttribute("minlength", "12");
  expect(screen.getByText(/reopen your original invitation/)).toBeInTheDocument();
});

it("validates password length and confirmation before accepting", async () => {
  await showForm();
  fillPassword("short");
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent("12–128 characters");
  fillPassword("a long password", "another password");
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");
  expect(acceptInvitation).not.toHaveBeenCalled();
});

it("accepts once while pending and clears passwords after confirmed success", async () => {
  let finish: (value: { email: string }) => void = () => undefined;
  vi.mocked(acceptInvitation).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onAccepted = vi.fn();
  await showForm(onAccepted);
  fillPassword();
  const form = screen.getByRole("button", { name: "Create account" }).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(acceptInvitation).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Creating account..." })).toBeDisabled();
  expect(screen.getByLabelText("Password")).toBeDisabled();
  expect(screen.getByLabelText("Confirm password")).toBeDisabled();
  await act(async () => { finish({ email: invitation.email }); });
  expect(onAccepted).toHaveBeenCalledExactlyOnceWith(invitation.email);
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(screen.getByLabelText("Confirm password")).toHaveValue("");
  fireEvent.submit(form);
  expect(acceptInvitation).toHaveBeenCalledTimes(1);
});

it.each([400, 403, 429])("preserves password and token after a definite %i failure", async (status) => {
  vi.mocked(acceptInvitation).mockRejectedValueOnce(new ApiError("validation_error", "Try again later", undefined, status))
    .mockResolvedValueOnce({ email: invitation.email });
  const onAccepted = vi.fn();
  await showForm(onAccepted);
  fillPassword();
  const form = screen.getByRole("button", { name: "Create account" }).closest("form")!;
  fireEvent.submit(form);
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again later");
  expect(screen.getByLabelText("Password")).toHaveValue("a long password");
  expect(screen.getByLabelText("Confirm password")).toHaveValue("a long password");
  fireEvent.submit(form);
  await waitFor(() => expect(onAccepted).toHaveBeenCalledOnce());
  expect(vi.mocked(acceptInvitation).mock.calls[1]?.slice(0, 2)).toEqual([token, "a long password"]);
});

it.each([
  new ApiError("service_unavailable", "Unavailable"),
  new ApiError("invalid_response", "Gateway returned HTML"),
  new ApiError("internal_error", "An unexpected error occurred", undefined, 500),
  new DOMException("Cancelled", "AbortError"),
])("offers sign-in recovery without replaying an uncertain acceptance: $name/$code", async (failure) => {
  vi.mocked(acceptInvitation).mockRejectedValue(failure);
  const onSignIn = vi.fn();
  await showForm(vi.fn(), onSignIn);
  fillPassword();
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Account setup may have completed");
  expect(screen.getByLabelText("Password")).toHaveValue("a long password");
  expect(acceptInvitation).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Sign in with the password you just chose" }));
  expect(onSignIn).toHaveBeenCalledWith(invitation.email, expect.stringContaining("Account setup may have completed"));
});

it("provides the same sign-in recovery when a retry finds the link already used", async () => {
  vi.mocked(acceptInvitation).mockRejectedValue(new ApiError("invitation_invalid", INVITATION_INVALID_MESSAGE, undefined, 400));
  await showForm();
  fillPassword();
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent(INVITATION_INVALID_MESSAGE);
  expect(screen.getByRole("button", { name: "Sign in with the password you just chose" })).toBeInTheDocument();
});

it("does not inspect malformed links or echo their contents", () => {
  render(<InvitationForm entry={{ invalid: true }} onAccepted={vi.fn()} onSignIn={vi.fn()} />);
  expect(screen.getByRole("alert")).toHaveTextContent(INVITATION_INVALID_MESSAGE);
  expect(inspectInvitation).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Go to sign in" })).toBeInTheDocument();
});

it("shows generic invalid-link recovery without revealing identity", async () => {
  vi.mocked(inspectInvitation).mockRejectedValueOnce(new ApiError("invitation_invalid", INVITATION_INVALID_MESSAGE, undefined, 400));
  const onSignIn = vi.fn();
  render(<InvitationForm entry={{ token }} onAccepted={vi.fn()} onSignIn={onSignIn} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(INVITATION_INVALID_MESSAGE);
  expect(screen.queryByText(invitation.email)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry invitation check" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
  expect(onSignIn).toHaveBeenCalledWith("", "");
});

it("retries an inspection service failure without consuming the invitation", async () => {
  vi.mocked(inspectInvitation).mockRejectedValueOnce(new ApiError("service_unavailable", "Temporarily unavailable"))
    .mockResolvedValueOnce(invitation);
  render(<InvitationForm entry={{ token }} onAccepted={vi.fn()} onSignIn={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry invitation check" }));
  await screen.findByRole("button", { name: "Create account" });
  expect(inspectInvitation).toHaveBeenCalledTimes(2);
  expect(acceptInvitation).not.toHaveBeenCalled();
});

it("ignores delayed inspection and acceptance results after unmount", async () => {
  let finishInspect: (value: typeof invitation) => void = () => undefined;
  vi.mocked(inspectInvitation).mockImplementationOnce(() => new Promise((resolve) => { finishInspect = resolve; }));
  const first = render(<InvitationForm entry={{ token }} onAccepted={vi.fn()} onSignIn={vi.fn()} />);
  const inspectSignal = vi.mocked(inspectInvitation).mock.calls[0]?.[1];
  first.unmount();
  expect(inspectSignal?.aborted).toBe(true);
  await act(async () => { finishInspect(invitation); });
  let finishAccept: (value: { email: string }) => void = () => undefined;
  vi.mocked(acceptInvitation).mockImplementationOnce(() => new Promise((resolve) => { finishAccept = resolve; }));
  const onAccepted = vi.fn();
  const second = await showForm(onAccepted);
  fillPassword();
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
  const acceptSignal = vi.mocked(acceptInvitation).mock.calls[0]?.[2];
  second.unmount();
  expect(acceptSignal?.aborted).toBe(true);
  await act(async () => { finishAccept({ email: invitation.email }); });
  expect(onAccepted).not.toHaveBeenCalled();
});

it("ignores an acceptance response after explicit dismissal", async () => {
  let finish: (value: { email: string }) => void = () => undefined;
  vi.mocked(acceptInvitation).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const onAccepted = vi.fn();
  const onSignIn = vi.fn();
  await showForm(onAccepted, onSignIn);
  fillPassword();
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
  fireEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
  expect(onSignIn).toHaveBeenCalledWith(invitation.email, expect.stringContaining("may have completed"));
  await act(async () => { finish({ email: invitation.email }); });
  expect(onAccepted).not.toHaveBeenCalled();
});
