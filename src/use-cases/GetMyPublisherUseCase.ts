import { PublisherDTO, toPublisherDTO } from '../entities/Publisher';
import { IPublisherRepo } from '../repos/PublisherRepo';
import { NotFoundError } from '../utils/errors';

export class GetMyPublisherUseCase {
  constructor(private publisherRepo: IPublisherRepo) {}

  async execute(userId: string): Promise<PublisherDTO> {
    const publisher = await this.publisherRepo.findByUserId(userId);
    if (!publisher) {
      throw new NotFoundError('Publisher');
    }
    return toPublisherDTO(publisher);
  }
}
