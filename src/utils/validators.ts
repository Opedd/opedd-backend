import { z } from 'zod';

// Publication Source Rules
export const publicationSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  platform: z.enum(['substack', 'beehiiv', 'ghost', 'wordpress', 'other']),
  verification_status: z.enum(['pending', 'verified', 'failed']).default('pending'),
  verification_token: z.string(), // The code for their bio
});

// Asset Rules
export const assetSchema = z.object({
  title: z.string().min(1),
  format: z.enum(['single_article', 'publication_post']),
  source_url: z.string().url().optional().nullable(),
  human_price: z.number().min(0),
  ai_price: z.number().min(0).optional().nullable(), // AI Price is now Optional
  content_preview_url: z.string().optional(),
});

export type PublicationInput = z.infer<typeof publicationSchema>;
export type AssetInput = z.infer<typeof assetSchema>;
