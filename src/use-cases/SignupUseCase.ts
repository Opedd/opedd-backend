import { UserDTO, toUserDTO } from '../entities/User';
import { PublisherDTO, toPublisherDTO } from '../entities/Publisher';
import { IUserRepo } from '../repos/UserRepo';
import { IPublisherRepo } from '../repos/PublisherRepo';
import { SignupInput } from '../utils/validators';
import { logger } from '../utils/logger';

export interface SignupResult {
  user: UserDTO;
  publisher: PublisherDTO;
}

export class SignupUseCase {
  constructor(
    private userRepo: IUserRepo,
    private publisherRepo: IPublisherRepo
  ) {}

  async execute(input: SignupInput): Promise<SignupResult> {
    logger.info('Processing signup', { email: input.email });

    const { user, publisherId } = await this.userRepo.create(
      input.email,
      input.password,
      input.name
    );

    const publisher = await this.publisherRepo.findById(publisherId);
    if (!publisher) {
      throw new Error('Publisher not found after creation');
    }

    logger.info('Signup successful', { userId: user.id, publisherId });

    return {
      user: toUserDTO(user),
      publisher: toPublisherDTO(publisher),
    };
  }
}
