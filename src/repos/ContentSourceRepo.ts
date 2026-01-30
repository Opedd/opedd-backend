import crypto from 'crypto';
import { ContentSource, SourceType, VerificationStatus } from '../entities/ContentSource';
import { getSupabaseClientForUser } from './supabase';

export interface CreateContentSourceData {
  userId: string;
  name: string;
  url: string;
  sourceType: SourceType;
}

export interface IContentSourceRepo {
  create(data: CreateContentSourceData, accessToken: string): Promise<ContentSource>;
  findByUserId(userId: string, accessToken: string): Promise<ContentSource[]>;
  findById(id: string, accessToken: string): Promise<ContentSource | null>;
  updateVerificationStatus(id: string, status: VerificationStatus, accessToken: string): Promise<ContentSource>;
}

export class SupabaseContentSourceRepo implements IContentSourceRepo {
  async create(data: CreateContentSourceData, accessToken: string): Promise<ContentSource> {
    const supabase = getSupabaseClientForUser(accessToken);
    const verificationToken = crypto.randomBytes(16).toString('hex');

    const { data: source, error } = await supabase
      .from('content_sources')
      .insert({
        user_id: data.userId,
        name: data.name,
        url: data.url,
        source_type: data.sourceType,
        verification_status: 'pending',
        verification_token: verificationToken,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create content source: ${error.message}`);
    }

    return this.mapToContentSource(source);
  }

  async findByUserId(userId: string, accessToken: string): Promise<ContentSource[]> {
    const supabase = getSupabaseClientForUser(accessToken);

    const { data, error } = await supabase
      .from('content_sources')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch content sources: ${error.message}`);
    }

    return data.map((s) => this.mapToContentSource(s));
  }

  async findById(id: string, accessToken: string): Promise<ContentSource | null> {
    const supabase = getSupabaseClientForUser(accessToken);

    const { data, error } = await supabase
      .from('content_sources')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapToContentSource(data);
  }

  async updateVerificationStatus(
    id: string,
    status: VerificationStatus,
    accessToken: string
  ): Promise<ContentSource> {
    const supabase = getSupabaseClientForUser(accessToken);

    const { data, error } = await supabase
      .from('content_sources')
      .update({ verification_status: status })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update verification status: ${error.message}`);
    }

    return this.mapToContentSource(data);
  }

  private mapToContentSource(data: Record<string, unknown>): ContentSource {
    return {
      id: data.id as string,
      userId: data.user_id as string,
      sourceType: data.source_type as SourceType,
      url: data.url as string,
      name: (data.name as string) ?? null,
      isActive: data.is_active as boolean,
      lastSyncAt: data.last_sync_at ? new Date(data.last_sync_at as string) : null,
      verificationStatus: (data.verification_status as VerificationStatus) ?? 'pending',
      verificationToken: (data.verification_token as string) ?? null,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }
}
