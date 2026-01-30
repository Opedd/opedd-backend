export type SourceType = 'rss' | 'substack' | 'ghost' | 'wordpress' | 'medium' | 'beehiiv' | 'other';
export type VerificationStatus = 'pending' | 'verified' | 'failed';

export interface ContentSource {
  id: string;
  userId: string;
  sourceType: SourceType;
  url: string;
  name: string | null;
  isActive: boolean;
  lastSyncAt: Date | null;
  verificationStatus: VerificationStatus;
  verificationToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentSourceDTO {
  id: string;
  userId: string;
  sourceType: SourceType;
  url: string;
  name: string | null;
  isActive: boolean;
  lastSyncAt: string | null;
  verificationStatus: VerificationStatus;
  verificationToken: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toContentSourceDTO(source: ContentSource): ContentSourceDTO {
  return {
    id: source.id,
    userId: source.userId,
    sourceType: source.sourceType,
    url: source.url,
    name: source.name,
    isActive: source.isActive,
    lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
    verificationStatus: source.verificationStatus,
    verificationToken: source.verificationToken,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}
