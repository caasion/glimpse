import "dotenv/config";

import { z } from "zod";

const stringToBoolFalseDefault = z
  .string()
  .default("false")
  .transform((value) => value === "true");

const stringToBoolTrueDefault = z
  .string()
  .default("true")
  .transform((value) => value === "true");

export const SettingsSchema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  BACKBOARD_API_KEY: z.string().min(1),
  BACKBOARD_BASE_URL: z.string().url().default("https://app.backboard.io/api"),
  SERPAPI_KEY: z.string().min(1),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  CLOUDINARY_UPLOAD_PRESET: z.string().default(""),
  PRODUCT_SOURCING_MODE: z.enum(["serpapi", "hardcoded"]).default("hardcoded"),
  CLOUDINARY_ENABLED: stringToBoolFalseDefault,
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(8000),
  DEBUG: stringToBoolTrueDefault,
});

export const settings = SettingsSchema.parse(process.env);
export type Settings = z.infer<typeof SettingsSchema>;
