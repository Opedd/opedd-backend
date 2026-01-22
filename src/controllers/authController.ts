import { Request, Response, NextFunction } from 'express';
import { SignupUseCase } from '../use-cases/SignupUseCase';
import { SupabaseUserRepo } from '../repos/UserRepo';
import { SupabasePublisherRepo } from '../repos/PublisherRepo';
import { getSupabaseClient } from '../repos/supabase';
import { loginSchema, LoginInput } from '../utils/validators';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';

const userRepo = new SupabaseUserRepo();
const publisherRepo = new SupabasePublisherRepo();
const signupUseCase = new SignupUseCase(userRepo, publisherRepo);

export async function signup(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await signupUseCase.execute(req.body);
    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = loginSchema.parse(req.body) as LoginInput;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error || !data.session) {
      logger.warn('Login failed', { email: input.email, error: error?.message });
      throw new AuthenticationError('Invalid email or password');
    }

    const publisher = await publisherRepo.findByUserId(data.user.id);

    res.json({
      success: true,
      data: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
        user: {
          id: data.user.id,
          email: data.user.email,
        },
        publisher: publisher
          ? {
              id: publisher.id,
              name: publisher.name,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
}
