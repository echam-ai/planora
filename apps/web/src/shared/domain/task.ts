import * as z from "zod/v3";

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);
export const taskCategorySchema = z.enum(["work", "personal", "study", "other"]);
export const taskPrioritySchema = z.enum(["low", "medium", "high"]);

export const taskUrlSchema = z.object({
  id: z.string(),
  url: z.string(),
  label: z.string().optional(),
});

export const taskDraftSchema = z.object({
  title: z.string(),
  content: z.string(),
  category: taskCategorySchema,
  priority: taskPrioritySchema,
  deadlineAt: z.string().nullable(),
  urls: z.array(taskUrlSchema),
  markdownNote: z.string(),
});

export const taskSchema = taskDraftSchema.extend({
  id: z.string(),
  status: taskStatusSchema,
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
});

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title."),
  content: z.string().trim().min(1, "Describe what needs to happen."),
  category: taskCategorySchema,
  priority: taskPrioritySchema,
  deadlineLocal: z.string().optional().or(z.literal("")),
  markdownNote: z.string(),
  urls: z.array(
    taskUrlSchema.extend({
      url: z.string().trim().url("Enter a full URL starting with http:// or https://"),
    }),
  ),
});

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskCategory = z.infer<typeof taskCategorySchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskUrl = z.infer<typeof taskUrlSchema>;
export type TaskDraft = z.infer<typeof taskDraftSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskFormValues = z.infer<typeof taskFormSchema>;
export type ParsedTaskText = TaskDraft;
