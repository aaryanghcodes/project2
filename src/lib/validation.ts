import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .email("That does not look like an email address.")
  .transform((value) => value.toLowerCase());

// Length is the only rule that reliably correlates with strength; complexity
// requirements mostly push people toward "Password1!" patterns. 72 is bcrypt's
// hard limit — bytes past it are silently ignored, so reject rather than
// quietly truncate.
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Passwords cannot be longer than 72 characters.");

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().max(80).optional(),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
