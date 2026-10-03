import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/queryClient";
import { Route } from "@/routes/archive";
import { api, type ArchivePage } from "@/services/api";
import type { Task } from "@/types";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  const ReactModule = await import("react");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode; [k: string]: unknown }) =>
      ReactModule.createElement("a", { href: to, ...rest }, children),
  };
});

const task = (id: string, title: string): Task => ({
  id,
  title,
  content: "Details",
  status: "done",
  category: "work",
  priority: "medium",
  deadlineAt: null,
  urls: [],
  markdownNote: "",
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
  archivedAt: "2026-02-01T00:00:00.000Z",
});

const pageOf = (items: Task[], page = 1, total = items.length, pageSize = 20): ArchivePage => ({
  items,
  total,
  page,
  pageSize,
});

const all = [task("a", "Water plants"), task("b", "Dentist appointment")];

function renderArchive() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  return render(
    createElement(QueryClientProvider, { client }, createElement(Route.options.component!)),
  );
}

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const type = (value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name: "Search archived tasks" }), {
    target: { value },
  });

beforeEach(() => {
  window.localStorage.setItem("planora.profile", "hamster_knight");
  vi.useFakeTimers();
  vi.spyOn(api, "getSettings").mockResolvedValue({
    timezone: "UTC",
    modelName: "kimi-k3",
    availableModels: ["kimi-k3"],
  });
  vi.spyOn(api, "getCurrentConversation").mockResolvedValue({ id: "c", messages: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Archive search", () => {
  it("shows the skeleton on first load only", async () => {
    vi.spyOn(api, "listArchive").mockResolvedValue(pageOf(all));
    const { container } = renderArchive();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    await flush();
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(screen.getByText("Dentist appointment")).toBeInTheDocument();
  });

  it("debounces typing into one request and keeps old results meanwhile", async () => {
    const listArchive = vi
      .spyOn(api, "listArchive")
      .mockImplementation(async (search = "") =>
        search === "dentist" ? pageOf([all[1]!]) : pageOf(all),
      );
    const { container } = renderArchive();
    await flush();
    listArchive.mockClear();

    const input = screen.getByRole("textbox", { name: "Search archived tasks" });
    for (const value of "dentist".split("").map((_, i, a) => a.slice(0, i + 1).join(""))) {
      type(value);
      expect(input).toHaveValue(value);
      await act(() => vi.advanceTimersByTimeAsync(50));
    }
    expect(listArchive).not.toHaveBeenCalled();
    expect(screen.getByText("Water plants")).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(199));
    expect(listArchive).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    await flush();
    expect(listArchive).toHaveBeenCalledTimes(1);
    expect(listArchive).toHaveBeenCalledWith("dentist", 1);
    expect(screen.queryByText("Water plants")).not.toBeInTheDocument();
    expect(screen.getByText("Dentist appointment")).toBeInTheDocument();
  });

  it("keeps previous cards and no skeleton while a new term loads", async () => {
    let release!: (page: ArchivePage) => void;
    const listArchive = vi.spyOn(api, "listArchive").mockResolvedValueOnce(pageOf(all));
    const { container } = renderArchive();
    await flush();
    listArchive.mockImplementation(() => new Promise((res) => (release = res)));

    type("dent");
    await act(() => vi.advanceTimersByTimeAsync(260));
    await flush();
    expect(listArchive).toHaveBeenLastCalledWith("dent", 1);
    expect(screen.getByText("Water plants")).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(screen.queryByText("No archived tasks match that search.")).not.toBeInTheDocument();

    release(pageOf([all[1]!]));
    await flush();
    expect(screen.queryByText("Water plants")).not.toBeInTheDocument();
  });

  it("resets to page 1 with the settled term and never requests the old term at the new page", async () => {
    const listArchive = vi
      .spyOn(api, "listArchive")
      .mockImplementation(async (search = "", page = 1) =>
        search === "dentist" ? pageOf([all[1]!], page, 40) : pageOf(all, page, 60),
      );
    renderArchive();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await flush();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    listArchive.mockClear();

    type("dentist");
    await act(() => vi.advanceTimersByTimeAsync(260));
    await flush();
    expect(listArchive.mock.calls).toEqual([["dentist", 1]]);
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("returns to the unfiltered first page when the search is cleared", async () => {
    const listArchive = vi
      .spyOn(api, "listArchive")
      .mockImplementation(async (search = "") => (search ? pageOf([]) : pageOf(all)));
    renderArchive();
    await flush();
    type("zzz");
    await act(() => vi.advanceTimersByTimeAsync(260));
    await flush();
    expect(screen.getByText("No archived tasks match that search.")).toBeInTheDocument();
    type("");
    await act(() => vi.advanceTimersByTimeAsync(260));
    await flush();
    // The unfiltered first page is still cached, so it shows without a new request.
    expect(listArchive.mock.calls.every(([term]) => term === "" || term === "zzz")).toBe(true);
    expect(screen.queryByText("No archived tasks match that search.")).not.toBeInTheDocument();
    expect(screen.getByText("Dentist appointment")).toBeInTheDocument();
  });

  it("shows the empty-archive message when nothing is archived and no term is set", async () => {
    vi.spyOn(api, "listArchive").mockResolvedValue(pageOf([]));
    renderArchive();
    await flush();
    expect(screen.getByText("Nothing archived yet.")).toBeInTheDocument();
  });

  it("shows the error state for the settled term and retries that term", async () => {
    const listArchive = vi.spyOn(api, "listArchive").mockResolvedValueOnce(pageOf(all));
    renderArchive();
    await flush();
    listArchive.mockRejectedValue(new Error("boom"));
    type("zzz");
    await act(() => vi.advanceTimersByTimeAsync(260));
    await flush();
    expect(screen.getByText("We couldn't load the archive.")).toBeInTheDocument();

    listArchive.mockClear();
    listArchive.mockResolvedValue(pageOf([]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(listArchive).toHaveBeenCalledWith("zzz", 1);
    expect(screen.getByText("No archived tasks match that search.")).toBeInTheDocument();
  });
});
