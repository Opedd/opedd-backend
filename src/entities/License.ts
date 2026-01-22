export type LicenseType = 'standard' | 'exclusive' | 'creative_commons';

export interface License {
  id: string;
  publisherId: string;
  title: string;
  description: string;
  licenseType: LicenseType;
  contentHash: string | null;
  metadata: Record<string, unknown>;
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
    createdAt: license.createdAt.toISOString(),
    updatedAt: license.updatedAt.toISOString(),
  };
}
