import { PublisherSettings } from '../entities/PublisherSettings';
import { getSupabaseClient } from './supabase';

export interface UpsertPublisherSettingsData {
  defaultHumanPrice?: number;
  defaultAiPrice?: number;
}

export interface IPublisherSettingsRepo {
  findByUserId(userId: string): Promise<PublisherSettings | null>;
  upsert(userId: string, data: UpsertPublisherSettingsData): Promise<PublisherSettings>;
}

export class SupabasePublisherSettingsRepo implements IPublisherSettingsRepo {
  async findByUserId(userId: string): Promise<PublisherSettings | null> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('publisher_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapToPublisherSettings(data);
  }

  async upsert(userId: string, data: UpsertPublisherSettingsData): Promise<PublisherSettings> {
    const supabase = getSupabaseClient();

    const row: Record<string, unknown> = { user_id: userId };
    if (data.defaultHumanPrice !== undefined) {
      row.default_human_price = data.defaultHumanPrice;
    }
    if (data.defaultAiPrice !== undefined) {
      row.default_ai_price = data.defaultAiPrice;
    }

    const { data: result, error } = await supabase
      .from('publisher_settings')
      .upsert(row, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to upsert publisher settings: ${error.message}`);
    }

    return this.mapToPublisherSettings(result);
  }

  private mapToPublisherSettings(data: Record<string, unknown>): PublisherSettings {
    return {
      userId: data.user_id as string,
      defaultHumanPrice: data.default_human_price as number,
      defaultAiPrice: data.default_ai_price as number,
      autoMintEnabled: data.auto_mint_enabled as boolean,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }
}
