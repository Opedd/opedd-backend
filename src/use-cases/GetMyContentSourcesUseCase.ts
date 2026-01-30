import { ContentSourceDTO, toContentSourceDTO } from '../entities/ContentSource';
import { IContentSourceRepo } from '../repos/ContentSourceRepo';
import { logger } from '../utils/logger';

export class GetMyContentSourcesUseCase {
  constructor(private contentSourceRepo: IContentSourceRepo) {}

  async execute(userId: string, accessToken: string): Promise<ContentSourceDTO[]> {
    logger.info('Fetching content sources for user', { userId });

    const sources = await this.contentSourceRepo.findByUserId(userId, accessToken);

    logger.info('Content sources fetched', { userId, count: sources.length });

    return sources.map(toContentSourceDTO);
  }
}
