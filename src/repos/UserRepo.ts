import { User } from '../entities/User';
import { getSupabaseClient } from './supabase';
import { AppError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface IUserRepo {
  create(email: string, password: string, name: string): Promise<{ user: User; publisherId: string }>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
}

export class SupabaseUserRepo implements IUserRepo {
  async create(email: string, password: string, name: string): Promise<{ user: User; publisherId: string }> {
    const supabase = getSupabaseClient();

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      logger.error('Failed to create auth user', { error: authError.message });
      if (authError.message.includes('already registered')) {
        throw new ConflictError('Email already registered');
      }
      throw new AppError(authError.message, 400);
    }

    if (!authData.user) {
      throw new AppError('Failed to create user');
    }

    const { data: publisher, error: publisherError } = await supabase
      .from('publishers')
      .insert({
        user_id: authData.user.id,
        name,
      })
      .select()
      .single();

    if (publisherError) {
      logger.error('Failed to create publisher', { error: publisherError.message });
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw new AppError('Failed to create publisher profile');
    }

    return {
      user: {
        id: authData.user.id,
        email: authData.user.email!,
        createdAt: new Date(authData.user.created_at),
        updatedAt: new Date(authData.user.updated_at || authData.user.created_at),
      },
      publisherId: publisher.id,
    };
  }

  async findById(id: string): Promise<User | null> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.auth.admin.getUserById(id);

    if (error || !data.user) {
      return null;
    }

    return {
      id: data.user.id,
      email: data.user.email!,
      createdAt: new Date(data.user.created_at),
      updatedAt: new Date(data.user.updated_at || data.user.created_at),
    };
  }

  async findByEmail(email: string): Promise<User | null> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.auth.admin.listUsers();

    if (error) {
      return null;
    }

    const user = data.users.find((u) => u.email === email);
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email!,
      createdAt: new Date(user.created_at),
      updatedAt: new Date(user.updated_at || user.created_at),
    };
  }
}
