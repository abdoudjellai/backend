import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("must be a valid email address")),
  password: z.string().min(1, "is required").max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
