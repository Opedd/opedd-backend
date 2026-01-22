import { License, LicenseType } from '../entities/License';
import { getSupabaseClientForUser } from './supabase';

export interface CreateLicenseData {
  publisherId: string;
  title: string;
  description: string;
  licenseType: LicenseType;
  contentHash: string | null;
  metadata: Record<string, unknown>;
}

export interface ILicenseRepo {
  create(data: CreateLicenseData, accessToken: string): Promise<License>;
  findByPublisherId(publisherId: string, accessToken: string): Promise<License[]>;
  findById(id: string, accessToken: string): Promise<License | null>;
}

export class SupabaseLicenseRepo implements ILicenseRepo {
  async create(data: CreateLicenseData, accessToken: string): Promise<License> {
    const supabase = getSupabaseClientForUser(accessToken);

    const { data: license, error } = await supabase
      .from('licenses')
      .insert({
        publisher_id: data.publisherId,
        title: data.title,
        description: data.description,
        license_type: data.licenseType,
        content_hash: data.contentHash,
        metadata: data.metadata,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create license: ${error.message}`);
    }

    return this.mapToLicense(license);
  }

  async findByPublisherId(publisherId: string, accessToken: string): Promise<License[]> {
    const supabase = getSupabaseClientForUser(accessToken);

    const { data, error } = await supabase
      .from('licenses')
      .select('*')
      .eq('publisher_id', publisherId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch licenses: ${error.message}`);
    }

    return data.map((l) => this.mapToLicense(l));
  }

  async findById(id: string, accessToken: string): Promise<License | null> {
    const supabase = getSupabaseClientForUser(accessToken);

    const { data, error } = await supabase
      .from('licenses')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapToLicense(data);
  }

  private mapToLicense(data: Record<string, unknown>): License {
    return {
      id: data.id as string,
      publisherId: data.publisher_id as string,
      title: data.title as string,
      description: data.description as string,
      licenseType: data.license_type as LicenseType,
      contentHash: data.content_hash as string | null,
      metadata: (data.metadata as Record<string, unknown>) || {},
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }
}
