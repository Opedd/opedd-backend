import { z } from 'zod';

// Content Source Rules
// verification_status and verification_token are generated server-side
// by ContentSourceRepo.create() — they must not be required from the client.
export const contentSourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  platform: z.enum(['substack', 'beehiiv', 'ghost', 'wordpress', 'other']),
  tags: z.array(z.string()).optional().default([]),
});

// Asset Rules
export const assetSchema = z.object({
  title: z.string().min(1),
  format: z.enum(['single_article', 'publication_post']),
  source_url: z.string().url().optional().nullable(),
  human_price: z.number().min(0),
  ai_price: z.number().min(0).optional().nullable(), // AI Price is now Optional
  content_preview_url: z.string().optional(),
  source_id: z.string().uuid().optional().nullable(),
});

// Auth Rules
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

// License Rules
export const createLicenseSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  licenseType: z.enum(['standard', 'exclusive', 'creative_commons']),
  contentHash: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// Publisher Rules
export const createPublisherSchema = z.object({
  name: z.string().min(1),
  platform: z.enum(['substack', 'beehiiv', 'ghost', 'wordpress', 'other']).optional(),
  url: z.string().url().optional(),
});

// Transaction Rules
export const createTransactionSchema = z.object({
  asset_id: z.string().uuid(),
  amount: z.number(),
  currency: z.string(),
});

export type ContentSourceInput = z.infer<typeof contentSourceSchema>;
export type AssetInput = z.infer<typeof assetSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type CreateLicenseInput = z.infer<typeof createLicenseSchema>;
export type CreatePublisherInput = z.infer<typeof createPublisherSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
