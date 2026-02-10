import { PublisherSettingsDTO, toPublisherSettingsDTO } from '../entities/PublisherSettings';
import { IPublisherSettingsRepo } from '../repos/PublisherSettingsRepo';

export class GetMyPublisherSettingsUseCase {
  constructor(private settingsRepo: IPublisherSettingsRepo) {}

  async execute(userId: string): Promise<PublisherSettingsDTO> {
    const settings = await this.settingsRepo.findByUserId(userId);
    if (!settings) {
      return {
        userId,
        defaultHumanPrice: 0,
        defaultAiPrice: 0,
        autoMintEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    return toPublisherSettingsDTO(settings);
  }
}
