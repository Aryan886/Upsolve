import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createAccount, ApiError } from "../api";
import { SignupForm } from "./SignupForm";

vi.mock("../api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api")>(),
  createAccount: vi.fn(),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

async function showForm(onAccepted = vi.fn(), onSignIn = vi.fn()) {
  const view = render(<SignupForm onAccepted={onAccepted} onSignIn={onSignIn} />);
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

it("shows a token-free form, password-manager fields and interruption guidance", async () => {
  await showForm();
  expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByText(/Already tried creating an account/)).toBeInTheDocument();
  expect(screen.getByText(/Email verification and automatic password recovery/)).toBeInTheDocument();
});

it("validates email, password and confirmation before submitting", async () => {
  await showForm();
  fillForm("invalid"); submit();
  expect(screen.getByRole("alert")).toHaveTextContent("valid email");
  fillForm("tester@example.com", "short"); submit();
  expect(screen.getByRole("alert")).toHaveTextContent("12–128");
  fillForm("tester@example.com", "a long password", "different password"); submit();
  expect(screen.getByRole("alert")).toHaveTextContent("do not match");
  expect(createAccount).not.toHaveBeenCalled();
});

it("submits once, normalizes email and clears secrets only after confirmed success", async () => {
  let finish: (result: { email: string }) => void = () => undefined;
  vi.mocked(createAccount).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onAccepted = vi.fn();
  await showForm(onAccepted);
  fillForm(); submit(); submit();
  expect(createAccount).toHaveBeenCalledTimes(1);
  expect(vi.mocked(createAccount).mock.calls[0]?.slice(0, 2)).toEqual([ "tester@example.com", "a long password"]);
  expect(screen.getByLabelText("Email")).toBeDisabled();
  expect(screen.getByLabelText("Password")).toHaveValue("a long password");
  await act(async () => { finish({ email: "tester@example.com" }); });
  expect(onAccepted).toHaveBeenCalledExactlyOnceWith("tester@example.com");
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(screen.getByLabelText("Confirm password")).toHaveValue("");
});

it("preserves input after a definite failure and offers sign-in after an uncertain response", async () => {
  vi.mocked(createAccount).mockRejectedValueOnce(new ApiError("validation_error", "Try again", undefined, 400))
    .mockRejectedValueOnce(new ApiError("invalid_response", "Mismatched response"));
  const onSignIn = vi.fn();
  await showForm(vi.fn(), onSignIn);
  fillForm(); submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
  expect(screen.getByLabelText("Email")).toHaveValue("TESTER@Example.com");
  expect(screen.getByLabelText("Password")).toHaveValue("a long password");
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Account setup may have completed");
  expect(createAccount).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Sign in with the password you just chose" }));
  expect(onSignIn).toHaveBeenCalledWith("tester@example.com", expect.stringContaining("may have completed"));
});

it("treats a mismatched success email as uncertain and ignores late results after dismissal", async () => {
  vi.mocked(createAccount).mockResolvedValueOnce({ email: "other@example.com" });
  const onAccepted = vi.fn();
  const onSignIn = vi.fn();
  await showForm(onAccepted, onSignIn);
  fillForm("tester@example.com"); submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Account setup may have completed");
  expect(onAccepted).not.toHaveBeenCalled();
  let finish: (result: { email: string }) => void = () => undefined;
  vi.mocked(createAccount).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  submit();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await act(async () => { finish({ email: "tester@example.com" }); });
  expect(onAccepted).not.toHaveBeenCalled();
  expect(onSignIn).toHaveBeenCalledOnce();
});

it("aborts acceptance and ignores a late result when unmounted", async () => {
  let finish: (result: { email: string }) => void = () => undefined;
  vi.mocked(createAccount).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const onAccepted = vi.fn();
  const view = await showForm(onAccepted);
  fillForm("tester@example.com"); submit();
  const signal = vi.mocked(createAccount).mock.calls[0]?.[2];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish({ email: "tester@example.com" }); });
  expect(onAccepted).not.toHaveBeenCalled();
});

it.each([400, 403, 409, 429])("preserves input after a definite %s response and permits deliberate retry", async (status) => {
  vi.mocked(createAccount).mockRejectedValue(new ApiError("signup_unavailable", "Try signing in or contact support.", undefined, status));
  await showForm();
  fillForm(); submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Try signing in");
  expect(screen.getByLabelText("Password")).toHaveValue("a long password");
  expect(screen.getByLabelText("Confirm password")).toHaveValue("a long password");
  expect(createAccount).toHaveBeenCalledOnce();
  submit();
  await act(async () => undefined);
  expect(createAccount).toHaveBeenCalledTimes(2);
});

it.each([
  new ApiError("service_unavailable", "Offline"),
  new ApiError("invalid_response", "Invalid JSON"),
  new ApiError("internal_error", "Server error", undefined, 500),
  new ApiError("gateway_error", "Gateway error", undefined, 502),
  new ApiError("timeout", "Timed out", undefined, 504),
  new DOMException("Cancelled", "AbortError"),
])("offers sign-in after an ambiguous failure without replay or storage", async (error) => {
  const storage = vi.spyOn(Storage.prototype, "setItem");
  vi.mocked(createAccount).mockRejectedValue(error);
  const onSignIn = vi.fn();
  await showForm(vi.fn(), onSignIn);
  fillForm("tester@example.com", "  password with spaces  "); submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("may have completed");
  expect(createAccount).toHaveBeenCalledExactlyOnceWith("tester@example.com", "  password with spaces  ", expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("button", { name: "Sign in with the password you just chose" }));
  expect(onSignIn).toHaveBeenCalledWith("tester@example.com", expect.stringContaining("may have completed"));
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});

it("returns a blank form after reload and does not submit again after success", async () => {
  vi.mocked(createAccount).mockResolvedValue({ email: "tester@example.com" });
  const view = await showForm();
  fillForm("tester@example.com"); submit();
  await act(async () => undefined);
  submit();
  expect(createAccount).toHaveBeenCalledOnce();
  view.unmount();
  await showForm();
  expect(screen.getByLabelText("Email")).toHaveValue("");
  expect(screen.getByLabelText("Password")).toHaveValue("");
});
