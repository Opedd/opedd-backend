export type LicenseType = 'standard' | 'exclusive' | 'creative_commons';
export type AccessType = 'human' | 'ai' | 'both';

export interface ContentSourceSummary {
  id: string;
  name: string | null;
  url: string;
  sourceType: string;
}

export interface License {
  id: string;
  publisherId: string;
  title: string;
  description: string;
  licenseType: LicenseType;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  sourceId: string | null;
  sourceUrl: string | null;
  humanPrice: number | null;
  aiPrice: number | null;
  accessType: AccessType;
  contentSource: ContentSourceSummary | null;
  publishedAt: Date | null;
  thumbnailUrl: string | null;
  verificationStatus: string;
  sourceStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LicenseDTO {
  id: string;
  publisherId: string;
  title: string;
  description: string;
  licenseType: LicenseType;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  sourceId: string | null;
  sourceUrl: string | null;
  humanPrice: number | null;
  aiPrice: number | null;
  accessType: AccessType;
  contentSource: ContentSourceSummary | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  verificationStatus: string;
  sourceStatus: string;
  createdAt: string;
  updatedAt: string;
}

export function toLicenseDTO(license: License): LicenseDTO {
  return {
    id: license.id,
    publisherId: license.publisherId,
    title: license.title,
    description: license.description,
    licenseType: license.licenseType,
    contentHash: license.contentHash,
    metadata: license.metadata,
    sourceId: license.sourceId,
    sourceUrl: license.sourceUrl,
    humanPrice: license.humanPrice,
    aiPrice: license.aiPrice,
    accessType: license.accessType,
    contentSource: license.contentSource,
    publishedAt: license.publishedAt ? license.publishedAt.toISOString() : null,
    thumbnailUrl: license.thumbnailUrl,
    verificationStatus: license.verificationStatus,
    sourceStatus: license.sourceStatus,
    createdAt: license.createdAt.toISOString(),
    updatedAt: license.updatedAt.toISOString(),
  };
}
