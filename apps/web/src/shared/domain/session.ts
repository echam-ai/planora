import * as z from "zod/v3";

export const credentialsSchema = z.object({
  username: z.string().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});

export const sessionSchema = z.object({
  username: z.string(),
  signedInAt: z.string(),
});

export type Credentials = z.infer<typeof credentialsSchema>;
export type Session = z.infer<typeof sessionSchema>;
