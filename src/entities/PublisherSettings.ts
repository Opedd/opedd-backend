export interface PublisherSettings {
  userId: string;
  defaultHumanPrice: number;
  defaultAiPrice: number;
  autoMintEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublisherSettingsDTO {
  userId: string;
  defaultHumanPrice: number;
  defaultAiPrice: number;
  autoMintEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toPublisherSettingsDTO(settings: PublisherSettings): PublisherSettingsDTO {
  return {
    userId: settings.userId,
    defaultHumanPrice: settings.defaultHumanPrice,
    defaultAiPrice: settings.defaultAiPrice,
    autoMintEnabled: settings.autoMintEnabled,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}
