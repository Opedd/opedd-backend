import { Request, Response, NextFunction } from 'express';
import { CreatePublisherUseCase } from '../use-cases/CreatePublisherUseCase';
import { SupabasePublisherRepo } from '../repos/PublisherRepo';
import { AuthenticatedRequest } from '../middleware/auth';

const publisherRepo = new SupabasePublisherRepo();
const createPublisherUseCase = new CreatePublisherUseCase(publisherRepo);

export async function createPublisher(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const publisher = await createPublisherUseCase.execute(
      req.body,
      authReq.user.id
    );

    res.status(201).json({
      success: true,
      data: publisher,
    });
  } catch (err) {
    next(err);
  }
}
