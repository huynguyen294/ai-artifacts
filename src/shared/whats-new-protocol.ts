import { z } from "zod";

export const whatsNewVersionSchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "Version must be a non-empty string.",
  });

const whatsNewRequestIdSchema = z.number().int().positive();

const whatsNewOpenVersionMessageSchema = z
  .object({
    type: z.literal("whatsNewOpenVersion"),
    requestId: whatsNewRequestIdSchema,
    version: whatsNewVersionSchema,
  })
  .strict();

export const whatsNewExtensionToWebviewMessageSchema = z.discriminatedUnion("type", [
  whatsNewOpenVersionMessageSchema,
]);

export const whatsNewWebviewToExtensionMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("whatsNewReady") }).strict(),
  z
    .object({
      type: z.literal("whatsNewNavigationApplied"),
      requestId: whatsNewRequestIdSchema,
      version: whatsNewVersionSchema,
    })
    .strict(),
  z.object({ type: z.literal("openExternal"), url: z.string().url() }).strict(),
]);

export type WhatsNewOpenVersionMessage = z.infer<typeof whatsNewOpenVersionMessageSchema>;
export type WhatsNewExtensionToWebviewMessage = z.infer<
  typeof whatsNewExtensionToWebviewMessageSchema
>;
export type WhatsNewWebviewToExtensionMessage = z.infer<
  typeof whatsNewWebviewToExtensionMessageSchema
>;

