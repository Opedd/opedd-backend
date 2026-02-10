import { Request, Response, NextFunction } from 'express';
import { CreatePublisherUseCase } from '../use-cases/CreatePublisherUseCase';
import { GetMyPublisherUseCase } from '../use-cases/GetMyPublisherUseCase';
import { GetMyPublisherSettingsUseCase } from '../use-cases/GetMyPublisherSettingsUseCase';
import { UpdatePublisherSettingsUseCase } from '../use-cases/UpdatePublisherSettingsUseCase';
import { SupabasePublisherRepo } from '../repos/PublisherRepo';
import { SupabasePublisherSettingsRepo } from '../repos/PublisherSettingsRepo';
import { AuthenticatedRequest } from '../middleware/auth';

const publisherRepo = new SupabasePublisherRepo();
const createPublisherUseCase = new CreatePublisherUseCase(publisherRepo);
const getMyPublisherUseCase = new GetMyPublisherUseCase(publisherRepo);

const settingsRepo = new SupabasePublisherSettingsRepo();
const getMyPublisherSettingsUseCase = new GetMyPublisherSettingsUseCase(settingsRepo);
const updatePublisherSettingsUseCase = new UpdatePublisherSettingsUseCase(settingsRepo);

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

export async function getMyPublisher(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const publisher = await getMyPublisherUseCase.execute(authReq.user.id);

    res.json({
      success: true,
      data: publisher,
    });
  } catch (err) {
    next(err);
  }
}

export async function getMyPublisherSettings(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const settings = await getMyPublisherSettingsUseCase.execute(authReq.user.id);

    res.json({
      success: true,
      data: settings,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateMyPublisherSettings(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const settings = await updatePublisherSettingsUseCase.execute(
      authReq.user.id,
      req.body
    );

    res.json({
      success: true,
      data: settings,
    });
  } catch (err) {
    next(err);
  }
}
