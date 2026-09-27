import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";
import { login } from "../api";
vi.mock("../api", () => ({ login: vi.fn(), changePassword: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("signs in once when submitted repeatedly while pending", async () => {
  let finish: (user: { id: number; email: string; createdAt: string }) => void = () => undefined;
  vi.mocked(login).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onLogin = vi.fn();
  render(<LoginForm onLogin={onLogin} />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long password" } });
  const form = screen.getByRole("button", { name: "Sign in" }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(login).toHaveBeenCalledTimes(1);
  finish({ id: 1, email: "a@example.com", createdAt: "now" });
  await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
});
it("keeps the email after a failed sign-in and shows the error", async () => {
  vi.mocked(login).mockRejectedValue(new Error("Email or password is incorrect"));
  render(<LoginForm onLogin={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect");
  expect(screen.getByLabelText("Email")).toHaveValue("a@example.com");
});
