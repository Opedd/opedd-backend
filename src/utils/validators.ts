import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const createLicenseSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(2000, 'Description too long').default(''),
  licenseType: z.enum(['standard', 'exclusive', 'creative_commons']),
  contentHash: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const createPublisherSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateLicenseInput = z.infer<typeof createLicenseSchema>;
export type CreatePublisherInput = z.infer<typeof createPublisherSchema>;
