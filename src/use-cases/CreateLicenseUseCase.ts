import { LicenseDTO, toLicenseDTO } from '../entities/License';
import { ILicenseRepo } from '../repos/LicenseRepo';
import { IPublisherRepo } from '../repos/PublisherRepo';
import { CreateLicenseInput } from '../utils/validators';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export class CreateLicenseUseCase {
  constructor(
    private licenseRepo: ILicenseRepo,
    private publisherRepo: IPublisherRepo
  ) {}

  async execute(
    input: CreateLicenseInput,
    userId: string,
    accessToken: string
  ): Promise<LicenseDTO> {
    logger.info('Creating license', { userId, title: input.title });

    const publisher = await this.publisherRepo.findByUserId(userId);
    if (!publisher) {
      throw new NotFoundError('Publisher');
    }

    const license = await this.licenseRepo.create(
      {
        publisherId: publisher.id,
        title: input.title,
        description: input.description,
        licenseType: input.licenseType,
        contentHash: input.contentHash ?? null,
        metadata: input.metadata,
      },
      accessToken
    );

    logger.info('License created', { licenseId: license.id, publisherId: publisher.id });

    return toLicenseDTO(license);
  }
}
