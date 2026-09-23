import { describe, expect, it } from "vitest";
import { taskDraftSchema, taskFormSchema, taskSchema, taskUrlSchema } from "@/shared/domain/task";
import { chatActionSchema, chatMessageSchema, conversationSchema } from "@/shared/domain/chat";
import { settingsSchema } from "@/shared/domain/settings";
import { credentialsSchema, sessionSchema } from "@/shared/domain/session";

const draft = {
  title: "Prepare review",
  content: "Write the review notes.",
  category: "work",
  priority: "high",
  deadlineAt: null,
  urls: [{ id: "url_1", url: "https://example.com", label: "Reference" }],
  markdownNote: "",
};

describe("shared domain schemas", () => {
  it("accepts existing task, draft, URL, settings, and session shapes without changing camelCase values", () => {
    const task = {
      ...draft,
      id: "task_seed_1",
      status: "todo",
      position: 0,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      completedAt: null,
      archivedAt: null,
    };

    expect(taskSchema.parse(task)).toEqual(task);
    expect(taskDraftSchema.parse(draft)).toEqual(draft);
    expect(taskUrlSchema.parse(draft.urls[0])).toEqual(draft.urls[0]);
    expect(settingsSchema.parse({ timezone: "Asia/Singapore", modelName: "kimi-k3" })).toEqual({
      timezone: "Asia/Singapore",
      modelName: "kimi-k3",
    });
    expect(sessionSchema.parse({ username: "demo", signedInAt: task.createdAt })).toEqual({
      username: "demo",
      signedInAt: task.createdAt,
    });
  });

  it("covers every task enum and nullable timestamp", () => {
    for (const status of ["todo", "in_progress", "done"]) {
      for (const category of ["work", "personal", "study", "other"]) {
        for (const priority of ["low", "medium", "high"]) {
          expect(
            taskSchema.safeParse({
              ...draft,
              id: "task_1",
              status,
              category,
              priority,
              position: 1,
              createdAt: "created",
              updatedAt: "updated",
              completedAt: null,
              archivedAt: null,
            }).success,
          ).toBe(true);
        }
      }
    }
  });

  it("accepts existing chat records with optional action and payload fields", () => {
    const action = {
      id: "act_1",
      kind: "create",
      title: "Create task",
      summary: "Prepare review",
      fields: [{ label: "Title", to: "Prepare review" }],
      status: "pending",
      payload: { draft },
    };
    const conversation = {
      id: "conversation_1",
      messages: [
        { id: "msg_1", role: "user", text: "Create this", createdAt: "now" },
        { id: "msg_2", role: "assistant", text: "I can do that", createdAt: "now", action },
      ],
    };

    expect(chatActionSchema.parse(action)).toEqual(action);
    expect(chatMessageSchema.parse(conversation.messages[0])).toEqual(conversation.messages[0]);
    expect(conversationSchema.parse(conversation)).toEqual(conversation);
  });

  it("accepts every chat action kind, status, and message role", () => {
    for (const kind of ["create", "update", "move", "schedule"]) {
      for (const status of ["pending", "applied", "rejected"]) {
        expect(
          chatActionSchema.safeParse({
            id: "act_1",
            kind,
            title: "Action",
            summary: "Summary",
            fields: [],
            status,
            payload: {},
          }).success,
        ).toBe(true);
      }
    }
    for (const role of ["user", "assistant"]) {
      expect(
        chatMessageSchema.safeParse({ id: "msg_1", role, text: "Hi", createdAt: "now" }).success,
      ).toBe(true);
    }
  });

  it("rejects unsupported enum values, missing required values, and incorrect primitives", () => {
    expect(taskSchema.safeParse({ ...draft, status: "later" }).success).toBe(false);
    expect(taskDraftSchema.safeParse({ ...draft, title: undefined }).success).toBe(false);
    expect(taskUrlSchema.safeParse({ id: "url_1", url: 42 }).success).toBe(false);
    expect(chatActionSchema.safeParse({ id: "act_1", kind: "delete" }).success).toBe(false);
    expect(settingsSchema.safeParse({ timezone: 42, modelName: "kimi-k3" }).success).toBe(false);
    expect(sessionSchema.safeParse({ username: "demo" }).success).toBe(false);
  });
});

describe("shared form schemas", () => {
  it("preserves structured task validation and its messages", () => {
    expect(
      taskFormSchema.parse({
        ...draft,
        deadlineLocal: "",
        urls: [{ id: "url_1", url: "https://example.com", label: "" }],
      }).deadlineLocal,
    ).toBe("");
    expect(
      taskFormSchema.safeParse({ ...draft, title: "   ", deadlineLocal: "" }).error?.issues[0]
        ?.message,
    ).toBe("Give the task a title.");
    expect(
      taskFormSchema.safeParse({ ...draft, content: "   ", deadlineLocal: "" }).error?.issues[0]
        ?.message,
    ).toBe("Describe what needs to happen.");
    expect(
      taskFormSchema.safeParse({
        ...draft,
        deadlineLocal: "",
        urls: [{ id: "url_1", url: "not a URL" }],
      }).error?.issues[0]?.message,
    ).toBe("Enter a full URL starting with http:// or https://");
  });

  it("keeps login messages and forwards surrounding spaces unchanged", () => {
    expect(credentialsSchema.parse({ username: " demo ", password: " pass " })).toEqual({
      username: " demo ",
      password: " pass ",
    });
    expect(
      credentialsSchema.safeParse({ username: "", password: "pass" }).error?.issues[0]?.message,
    ).toBe("Enter your username");
    expect(
      credentialsSchema.safeParse({ username: "demo", password: "" }).error?.issues[0]?.message,
    ).toBe("Enter your password");
  });
});
