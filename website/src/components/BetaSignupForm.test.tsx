import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptBetaSignup, ApiError, inspectBetaSignup } from "../api";
import { BetaSignupForm } from "./BetaSignupForm";

vi.mock("../api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api")>(),
  inspectBetaSignup: vi.fn(),
  acceptBetaSignup: vi.fn(),
}));

const token = "b".repeat(43);
const signup = { expiresAt: "2030-01-08T00:00:00.000Z", remainingSignups: 30 };
beforeEach(() => { vi.mocked(inspectBetaSignup).mockResolvedValue(signup); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

async function showForm(onAccepted = vi.fn(), onSignIn = vi.fn()) {
  const view = render(<BetaSignupForm entry={{ kind: "beta", token }} onAccepted={onAccepted} onSignIn={onSignIn} />);
  await screen.findByRole("button", { name: "Create account" });
  return view;
}

function fillForm(email = "  TESTER@Example.com  ", password = "a long password", confirmation = password): void {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirmation } });
}

function submit(): void {
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
}

it("shows loading, available spots, expiry and labeled account fields", async () => {
  let finish: (result: typeof signup) => void = () => undefined;
  vi.mocked(inspectBetaSignup).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<BetaSignupForm entry={{ kind: "beta", token }} onAccepted={vi.fn()} onSignIn={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("Checking the beta link");
  await act(async () => { finish(signup); });
  expect(screen.getByText(/30 beta spots currently remain/)).toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByText(/reopen the original beta link/)).toBeInTheDocument();
});

it("validates email, password and confirmation before submitting", async () => {
  await showForm();
  fillForm("invalid"); submit();
  expect(screen.getByRole("alert")).toHaveTextContent("valid email");
  fillForm("tester@example.com", "short"); submit();
  expect(screen.getByRole("alert")).toHaveTextContent("12–128");
  fillForm("tester@example.com", "a long password", "different password"); submit();
  expect(screen.getByRole("alert")).toHaveTextContent("do not match");
  expect(acceptBetaSignup).not.toHaveBeenCalled();
});

it("submits once, normalizes email and clears secrets only after confirmed success", async () => {
  let finish: (result: { email: string }) => void = () => undefined;
  vi.mocked(acceptBetaSignup).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onAccepted = vi.fn();
  await showForm(onAccepted);
  fillForm(); submit(); submit();
  expect(acceptBetaSignup).toHaveBeenCalledTimes(1);
  expect(vi.mocked(acceptBetaSignup).mock.calls[0]?.slice(0, 3)).toEqual([token, "tester@example.com", "a long password"]);
  expect(screen.getByLabelText("Email")).toBeDisabled();
  expect(screen.getByLabelText("Password")).toHaveValue("a long password");
  await act(async () => { finish({ email: "tester@example.com" }); });
  expect(onAccepted).toHaveBeenCalledExactlyOnceWith("tester@example.com");
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(screen.getByLabelText("Confirm password")).toHaveValue("");
});

it("preserves input after a definite failure and offers sign-in after an uncertain response", async () => {
  vi.mocked(acceptBetaSignup).mockRejectedValueOnce(new ApiError("validation_error", "Try again", undefined, 400))
    .mockRejectedValueOnce(new ApiError("invalid_response", "Mismatched response"));
  const onSignIn = vi.fn();
  await showForm(vi.fn(), onSignIn);
  fillForm(); submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
  expect(screen.getByLabelText("Email")).toHaveValue("TESTER@Example.com");
  expect(screen.getByLabelText("Password")).toHaveValue("a long password");
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Account setup may have completed");
  expect(acceptBetaSignup).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Sign in with the password you just chose" }));
  expect(onSignIn).toHaveBeenCalledWith("tester@example.com", expect.stringContaining("may have completed"));
});

it("treats a mismatched success email as uncertain and ignores late results after dismissal", async () => {
  vi.mocked(acceptBetaSignup).mockResolvedValueOnce({ email: "other@example.com" });
  const onAccepted = vi.fn();
  const onSignIn = vi.fn();
  await showForm(onAccepted, onSignIn);
  fillForm("tester@example.com"); submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Account setup may have completed");
  expect(onAccepted).not.toHaveBeenCalled();
  let finish: (result: { email: string }) => void = () => undefined;
  vi.mocked(acceptBetaSignup).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  submit();
  fireEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
  await act(async () => { finish({ email: "tester@example.com" }); });
  expect(onAccepted).not.toHaveBeenCalled();
  expect(onSignIn).toHaveBeenCalledOnce();
});

it("shows full or expired links with sign-in and retries only temporary check failures", async () => {
  vi.mocked(inspectBetaSignup).mockRejectedValueOnce(new ApiError("service_unavailable", "Temporarily unavailable"))
    .mockRejectedValueOnce(new ApiError("beta_full", "Beta is full", undefined, 400));
  render(<BetaSignupForm entry={{ kind: "beta", token }} onAccepted={vi.fn()} onSignIn={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry link check" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Beta is full");
  expect(screen.queryByRole("button", { name: "Retry link check" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Go to sign in" })).toBeInTheDocument();
  expect(acceptBetaSignup).not.toHaveBeenCalled();
});

it("aborts inspection and acceptance when unmounted", async () => {
  let finishInspect: (result: typeof signup) => void = () => undefined;
  vi.mocked(inspectBetaSignup).mockImplementationOnce(() => new Promise((resolve) => { finishInspect = resolve; }));
  const first = render(<BetaSignupForm entry={{ kind: "beta", token }} onAccepted={vi.fn()} onSignIn={vi.fn()} />);
  const inspectSignal = vi.mocked(inspectBetaSignup).mock.calls[0]?.[1];
  first.unmount();
  expect(inspectSignal?.aborted).toBe(true);
  await act(async () => { finishInspect(signup); });
  let finishAccept: (result: { email: string }) => void = () => undefined;
  vi.mocked(acceptBetaSignup).mockImplementationOnce(() => new Promise((resolve) => { finishAccept = resolve; }));
  const onAccepted = vi.fn();
  const second = await showForm(onAccepted);
  fillForm("tester@example.com"); submit();
  const acceptSignal = vi.mocked(acceptBetaSignup).mock.calls[0]?.[3];
  second.unmount();
  expect(acceptSignal?.aborted).toBe(true);
  await act(async () => { finishAccept({ email: "tester@example.com" }); });
  expect(onAccepted).not.toHaveBeenCalled();
});
