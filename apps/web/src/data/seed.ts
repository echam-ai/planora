import type { Task, TaskCategory, TaskPriority, TaskStatus } from "@/types";
import { uid } from "@/lib/id";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type SeedSpec = {
  title: string;
  content: string;
  status: TaskStatus;
  category: TaskCategory;
  priority: TaskPriority;
  deadlineOffset: number | null;
  urls?: { url: string; label?: string }[];
  note?: string;
  completedOffset?: number;
  archivedOffset?: number;
};

const activeSpecs: SeedSpec[] = [
  {
    title: "Ship the search-quality review deck",
    content:
      "Pull last month's relevance metrics, write up the three biggest regressions and propose fixes for the review meeting.",
    status: "todo",
    category: "work",
    priority: "high",
    deadlineOffset: -6 * HOUR,
    urls: [
      { url: "https://example.com/dashboard", label: "Metrics dashboard" },
      { url: "https://example.com/deck-template", label: "Deck template" },
    ],
    note: "## Outline\n\n- [ ] Intro & scope\n- [ ] Top regressions\n- [ ] Proposed fixes\n\n> Keep it under 12 slides.",
  },
  {
    title: "Renew passport",
    content: "Book the appointment slot and print the confirmation plus two photos.",
    status: "todo",
    category: "personal",
    priority: "high",
    deadlineOffset: 5 * HOUR,
    urls: [{ url: "https://example.com/appointments", label: "Booking portal" }],
  },
  {
    title: "Read chapter 4 of the distributed systems book",
    content: "Consensus and replication. Take notes on Raft leader election.",
    status: "todo",
    category: "study",
    priority: "medium",
    deadlineOffset: 3 * DAY,
    note: "`Raft` = leader election + log replication + safety.",
  },
  {
    title: "Tidy the garage shelves",
    content: "Sort the tool boxes, throw out the empty paint tins.",
    status: "todo",
    category: "other",
    priority: "low",
    deadlineOffset: null,
  },
  {
    title: "Draft Q4 hiring plan",
    content:
      "Headcount by team, expected start dates, and the interview loop changes we agreed on.",
    status: "todo",
    category: "work",
    priority: "medium",
    deadlineOffset: 6 * DAY,
  },
  {
    title: "Fix flaky checkout integration test",
    content:
      "The payment webhook test fails roughly one run in five. Suspect a race between the fixture teardown and the retry queue.",
    status: "in_progress",
    category: "work",
    priority: "high",
    deadlineOffset: 18 * HOUR,
    urls: [{ url: "https://example.com/ci/run/8421", label: "Failing CI run" }],
    note: "### Findings\n\n1. Teardown runs before retry flush\n2. Retry queue has no drain hook\n\n```ts\nawait queue.drain();\n```",
  },
  {
    title: "Spanish lesson prep",
    content: "Review the past subjunctive drills and write five example sentences.",
    status: "in_progress",
    category: "study",
    priority: "low",
    deadlineOffset: 2 * DAY,
  },
  {
    title: "Plan the weekend trip to Malacca",
    content: "Compare bus times, pick a hotel near Jonker Street, and make a short food list.",
    status: "in_progress",
    category: "personal",
    priority: "medium",
    deadlineOffset: null,
    urls: [
      { url: "https://example.com/bus", label: "Bus times" },
      { url: "https://example.com/hotels", label: "Hotels" },
      { url: "https://example.com/food", label: "Food list" },
    ],
  },
  {
    title: "Replace the kitchen tap washer",
    content: "Buy a 15mm washer set on the way home.",
    status: "in_progress",
    category: "other",
    priority: "low",
    deadlineOffset: 10 * HOUR,
  },
  {
    title: "Write the weekly status update",
    content: "Short summary of shipped work, blockers, and next week's focus.",
    status: "done",
    category: "work",
    priority: "medium",
    deadlineOffset: -2 * DAY,
    completedOffset: -2 * DAY,
  },
  {
    title: "Submit the reimbursement claim",
    content: "Conference tickets and two taxi receipts.",
    status: "done",
    category: "personal",
    priority: "low",
    deadlineOffset: -5 * HOUR,
    completedOffset: -8 * HOUR,
  },
  {
    title: "Finish the linear algebra problem set",
    content: "Eigenvalues section, questions 7 to 14.",
    status: "done",
    category: "study",
    priority: "high",
    deadlineOffset: -4 * DAY,
    completedOffset: -4 * DAY,
    note: "Check Q12 again — eigenvector normalisation felt wrong.",
  },
];

const archiveSpecs: SeedSpec[] = [
  {
    title: "Migrate the staging database to Postgres 16",
    content: "Dump, restore, and rerun the smoke suite.",
    status: "done",
    category: "work",
    priority: "high",
    deadlineOffset: -12 * DAY,
    completedOffset: -12 * DAY,
    archivedOffset: -11 * DAY,
  },
  {
    title: "Dentist appointment",
    content: "Routine cleaning at 9:30.",
    status: "done",
    category: "personal",
    priority: "medium",
    deadlineOffset: -15 * DAY,
    completedOffset: -15 * DAY,
    archivedOffset: -14 * DAY,
  },
  {
    title: "Study notes for the statistics midterm",
    content: "Confidence intervals and hypothesis testing summary sheet.",
    status: "done",
    category: "study",
    priority: "high",
    deadlineOffset: -20 * DAY,
    completedOffset: -21 * DAY,
    archivedOffset: -19 * DAY,
    note: "Summary sheet lives in the study folder.",
  },
  {
    title: "Cancel the unused streaming subscription",
    content: "Cancelled and confirmed by email.",
    status: "done",
    category: "other",
    priority: "low",
    deadlineOffset: null,
    completedOffset: -23 * DAY,
    archivedOffset: -22 * DAY,
  },
  {
    title: "Review pull request for the search ranking tweak",
    content: "Approved with two small comments about test naming.",
    status: "done",
    category: "work",
    priority: "medium",
    deadlineOffset: -26 * DAY,
    completedOffset: -26 * DAY,
    archivedOffset: -25 * DAY,
    urls: [{ url: "https://example.com/pr/331", label: "Pull request" }],
  },
  {
    title: "Book flights for the December break",
    content: "Return tickets booked, seats chosen.",
    status: "done",
    category: "personal",
    priority: "high",
    deadlineOffset: -30 * DAY,
    completedOffset: -31 * DAY,
    archivedOffset: -29 * DAY,
  },
];

function build(specs: SeedSpec[], now: number): Task[] {
  const counters: Record<TaskStatus, number> = { todo: 0, in_progress: 0, done: 0 };
  return specs.map((s, i) => {
    const created = new Date(now - (specs.length - i) * 6 * HOUR).toISOString();
    return {
      id: uid("task"),
      title: s.title,
      content: s.content,
      status: s.status,
      category: s.category,
      priority: s.priority,
      deadlineAt: s.deadlineOffset === null ? null : new Date(now + s.deadlineOffset).toISOString(),
      urls: (s.urls ?? []).map((u) => ({ id: uid("url"), ...u })),
      markdownNote: s.note ?? "",
      position: counters[s.status]++,
      createdAt: created,
      updatedAt: created,
      completedAt: s.completedOffset ? new Date(now + s.completedOffset).toISOString() : null,
      archivedAt: s.archivedOffset ? new Date(now + s.archivedOffset).toISOString() : null,
    };
  });
}

export function createSeedTasks(): Task[] {
  const now = Date.now();
  return [...build(activeSpecs, now), ...build(archiveSpecs, now)];
}
