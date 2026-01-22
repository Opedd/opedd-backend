import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../repos/supabase';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
  };
  accessToken: string;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);

    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch {
      throw new AuthenticationError('Authentication service unavailable');
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      logger.warn('Invalid token attempt', { error: error?.message });
      throw new AuthenticationError('Invalid or expired token');
    }

    (req as AuthenticatedRequest).user = {
      id: data.user.id,
      email: data.user.email!,
    };
    (req as AuthenticatedRequest).accessToken = token;

    next();
  } catch (err) {
    next(err);
  }
}
