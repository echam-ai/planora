import * as z from "zod/v3";
import { taskDraftSchema, taskStatusSchema } from "./task";

export const chatActionKindSchema = z.enum(["create", "update", "move", "schedule"]);
export const chatActionStatusSchema = z.enum(["pending", "applied", "rejected"]);
export const chatMessageRoleSchema = z.enum(["user", "assistant"]);

export const chatActionFieldSchema = z.object({
  label: z.string(),
  from: z.string().optional(),
  to: z.string(),
});

export const chatActionPayloadSchema = z.object({
  taskId: z.string().optional(),
  draft: taskDraftSchema.optional(),
  status: taskStatusSchema.optional(),
  deadlineAt: z.string().nullable().optional(),
});

export const chatActionSchema = z.object({
  id: z.string(),
  kind: chatActionKindSchema,
  title: z.string(),
  summary: z.string(),
  fields: z.array(chatActionFieldSchema),
  status: chatActionStatusSchema,
  payload: chatActionPayloadSchema,
});

export const chatMessageSchema = z.object({
  id: z.string(),
  role: chatMessageRoleSchema,
  text: z.string(),
  createdAt: z.string(),
  action: chatActionSchema.optional(),
});

export const conversationSchema = z.object({
  id: z.string(),
  messages: z.array(chatMessageSchema),
});

export type ChatActionKind = z.infer<typeof chatActionKindSchema>;
export type ChatActionStatus = z.infer<typeof chatActionStatusSchema>;
export type ChatMessageRole = z.infer<typeof chatMessageRoleSchema>;
export type ChatActionField = z.infer<typeof chatActionFieldSchema>;
export type ChatActionPayload = z.infer<typeof chatActionPayloadSchema>;
export type ChatAction = z.infer<typeof chatActionSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
