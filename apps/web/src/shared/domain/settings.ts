import * as z from "zod/v3";

export const settingsSchema = z.object({
  timezone: z.string(),
  modelName: z.string(),
  availableModels: z.array(z.string()),
});

export type AppSettings = z.infer<typeof settingsSchema>;
