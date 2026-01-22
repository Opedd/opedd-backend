import { PublisherDTO, toPublisherDTO } from '../entities/Publisher';
import { IPublisherRepo } from '../repos/PublisherRepo';
import { CreatePublisherInput } from '../utils/validators';
import { ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';

export class CreatePublisherUseCase {
  constructor(private publisherRepo: IPublisherRepo) {}

  async execute(
    input: CreatePublisherInput,
    userId: string
  ): Promise<PublisherDTO> {
    logger.info('Creating publisher', { userId, name: input.name });

    const existing = await this.publisherRepo.findByUserId(userId);
    if (existing) {
      throw new ConflictError('Publisher already exists for this user');
    }

    const publisher = await this.publisherRepo.create({
      userId,
      name: input.name,
    });

    logger.info('Publisher created', { publisherId: publisher.id, userId });

    return toPublisherDTO(publisher);
  }
}
