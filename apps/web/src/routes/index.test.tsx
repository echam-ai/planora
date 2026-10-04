import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  localStorage.setItem("planora.access", "1");
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
it("shows each account as one named button with its own aria-hidden illustration", async () => {
  vi.spyOn(api, "getProfiles").mockResolvedValue(PROFILES);
  const { container } = mount();
  expect(screen.getByRole("heading", { name: "Choose your account" })).toBeVisible();
  expect(screen.getByText(/Two separate workspaces/)).toBeVisible();
  const hamster = await screen.findByRole("button", { name: /^Hamster Knight$/ });
  const princess = screen.getByRole("button", { name: /^Ech Princess$/ });
  expect(screen.getAllByRole("button")).toHaveLength(2);
  expect(hamster.querySelector('svg[aria-hidden="true"][data-mascot="hamster"]')).not.toBeNull();
  expect(princess.querySelector('svg[aria-hidden="true"][data-mascot="frog"]')).not.toBeNull();
  expect(princess).toHaveAccessibleDescription("Royal to-dos, beautifully organized.");
  expect(within(hamster).queryByRole("img")).toBeNull();
  // Inline art only: nothing is fetched by URL.
  expect(container.querySelector("img, image, use[href], [style*='url(']")).toBeNull();
});
it("holds a placeholder card per account while the catalog loads", () => {
  vi.spyOn(api, "getProfiles").mockReturnValue(new Promise(() => {}));
  mount();
  expect(screen.getByRole("status")).toHaveTextContent("Loading accounts…");
  expect(screen.getAllByTestId("profile-placeholder")).toHaveLength(2);
  expect(screen.queryByRole("button")).toBeNull();
});
it("shows the failure as an alert with an icon and no placeholders", async () => {
  vi.spyOn(api, "getProfiles").mockRejectedValue(new Error("offline"));
  mount();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("We couldn't load accounts.");
  expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(screen.queryByTestId("profile-placeholder")).toBeNull();
});
it("locks both options once an account is chosen", async () => {
  vi.spyOn(api, "getProfiles").mockResolvedValue(PROFILES);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Hamster Knight" }));
  expect(screen.getByRole("button", { name: "Hamster Knight" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Ech Princess" })).toBeDisabled();
});
