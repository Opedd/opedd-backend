import { ContentSourceDTO, toContentSourceDTO } from '../entities/ContentSource';
import { IContentSourceRepo } from '../repos/ContentSourceRepo';
import { ContentSourceInput } from '../utils/validators';
import { logger } from '../utils/logger';

export class CreateContentSourceUseCase {
  constructor(private contentSourceRepo: IContentSourceRepo) {}

  async execute(
    input: ContentSourceInput,
    userId: string,
    accessToken: string
  ): Promise<ContentSourceDTO> {
    logger.info('Creating content source', { userId, url: input.url });

    const source = await this.contentSourceRepo.create(
      {
        userId,
        name: input.name,
        url: input.url,
        sourceType: input.platform,
      },
      accessToken
    );

    logger.info('Content source created', { sourceId: source.id, userId });

    return toContentSourceDTO(source);
  }
}
