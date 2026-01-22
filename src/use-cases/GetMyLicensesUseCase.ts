import { LicenseDTO, toLicenseDTO } from '../entities/License';
import { ILicenseRepo } from '../repos/LicenseRepo';
import { IPublisherRepo } from '../repos/PublisherRepo';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export class GetMyLicensesUseCase {
  constructor(
    private licenseRepo: ILicenseRepo,
    private publisherRepo: IPublisherRepo
  ) {}

  async execute(userId: string, accessToken: string): Promise<LicenseDTO[]> {
    logger.info('Fetching licenses for user', { userId });

    const publisher = await this.publisherRepo.findByUserId(userId);
    if (!publisher) {
      throw new NotFoundError('Publisher');
    }

    const licenses = await this.licenseRepo.findByPublisherId(
      publisher.id,
      accessToken
    );

    logger.info('Licenses fetched', { userId, count: licenses.length });

    return licenses.map(toLicenseDTO);
  }
}
