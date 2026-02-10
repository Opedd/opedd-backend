import { PublisherSettingsDTO, toPublisherSettingsDTO } from '../entities/PublisherSettings';
import { IPublisherSettingsRepo, UpsertPublisherSettingsData } from '../repos/PublisherSettingsRepo';

export class UpdatePublisherSettingsUseCase {
  constructor(private settingsRepo: IPublisherSettingsRepo) {}

  async execute(userId: string, data: UpsertPublisherSettingsData): Promise<PublisherSettingsDTO> {
    const settings = await this.settingsRepo.upsert(userId, data);
    return toPublisherSettingsDTO(settings);
  }
}
