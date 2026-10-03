import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Route } from "./index";
import { api } from "@/services/api";
import { PROFILES, getSelectedProfile } from "@/services/api/profiles";
const AccountChooser = Route.options.component!;
const navigate = vi.fn();
vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual("@tanstack/react-router")),
  useNavigate: () => navigate,
}));
beforeEach(() => {
  localStorage.clear();
  navigate.mockClear();
});
afterEach(() => vi.restoreAllMocks());
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AccountChooser />
    </QueryClientProvider>,
  );
}
it("always offers both accounts, remembers choice and opens board without credentials", async () => {
  localStorage.setItem("planora.profile", "hamster_knight");
  vi.spyOn(api, "getProfiles").mockResolvedValue(PROFILES);
  mount();
  expect(await screen.findByRole("button", { name: "Hamster Knight" })).toBeVisible();
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Ech Princess" }));
  expect(getSelectedProfile()).toBe("ech_princess");
  expect(navigate).toHaveBeenCalledWith({ to: "/tasks" });
});
it("recovers a failed catalog load", async () => {
  const get = vi
    .spyOn(api, "getProfiles")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(PROFILES);
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't load accounts");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("button", { name: "Ech Princess" });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});
