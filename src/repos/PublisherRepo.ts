import { Publisher } from '../entities/Publisher';
import { getSupabaseClient, getSupabaseClientForUser } from './supabase';
import { NotFoundError } from '../utils/errors';

export interface CreatePublisherData {
  userId: string;
  name: string;
}

export interface IPublisherRepo {
  create(data: CreatePublisherData): Promise<Publisher>;
  findByUserId(userId: string): Promise<Publisher | null>;
  findById(id: string): Promise<Publisher | null>;
}

export class SupabasePublisherRepo implements IPublisherRepo {
  async create(data: CreatePublisherData): Promise<Publisher> {
    const supabase = getSupabaseClient();

    const { data: publisher, error } = await supabase
      .from('publishers')
      .insert({
        user_id: data.userId,
        name: data.name,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create publisher: ${error.message}`);
    }

    return this.mapToPublisher(publisher);
  }

  async findByUserId(userId: string): Promise<Publisher | null> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('publishers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapToPublisher(data);
  }

  async findById(id: string): Promise<Publisher | null> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('publishers')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapToPublisher(data);
  }

  private mapToPublisher(data: Record<string, unknown>): Publisher {
    return {
      id: data.id as string,
      userId: data.user_id as string,
      name: data.name as string,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }
}
