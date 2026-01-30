import { License, LicenseType, AccessType, ContentSourceSummary } from '../entities/License';
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

const LICENSE_SELECT = `
  *,
  content_sources (
    id,
    name,
    url,
    source_type
  )
`;

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
      .select(LICENSE_SELECT)
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
      .select(LICENSE_SELECT)
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
      .select(LICENSE_SELECT)
      .eq('id', id)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapToLicense(data);
  }

  private mapToLicense(data: Record<string, unknown>): License {
    let contentSource: ContentSourceSummary | null = null;
    const cs = data.content_sources as Record<string, unknown> | null;
    if (cs && cs.id) {
      contentSource = {
        id: cs.id as string,
        name: (cs.name as string) ?? null,
        url: cs.url as string,
        sourceType: cs.source_type as string,
      };
    }

    return {
      id: data.id as string,
      publisherId: data.publisher_id as string,
      title: data.title as string,
      description: data.description as string,
      licenseType: data.license_type as LicenseType,
      contentHash: (data.content_hash as string) ?? null,
      metadata: (data.metadata as Record<string, unknown>) || {},
      sourceId: (data.source_id as string) ?? null,
      sourceUrl: (data.source_url as string) ?? null,
      humanPrice: data.human_price != null ? Number(data.human_price) : null,
      aiPrice: data.ai_price != null ? Number(data.ai_price) : null,
      accessType: (data.access_type as AccessType) ?? 'both',
      contentSource,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }
}
