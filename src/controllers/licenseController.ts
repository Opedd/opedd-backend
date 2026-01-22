import { Request, Response, NextFunction } from 'express';
import { CreateLicenseUseCase } from '../use-cases/CreateLicenseUseCase';
import { GetMyLicensesUseCase } from '../use-cases/GetMyLicensesUseCase';
import { SupabaseLicenseRepo } from '../repos/LicenseRepo';
import { SupabasePublisherRepo } from '../repos/PublisherRepo';
import { AuthenticatedRequest } from '../middleware/auth';

const licenseRepo = new SupabaseLicenseRepo();
const publisherRepo = new SupabasePublisherRepo();
const createLicenseUseCase = new CreateLicenseUseCase(licenseRepo, publisherRepo);
const getMyLicensesUseCase = new GetMyLicensesUseCase(licenseRepo, publisherRepo);

export async function createLicense(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const license = await createLicenseUseCase.execute(
      req.body,
      authReq.user.id,
      authReq.accessToken
    );

    res.status(201).json({
      success: true,
      data: license,
    });
  } catch (err) {
    next(err);
  }
}

export async function getMyLicenses(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const licenses = await getMyLicensesUseCase.execute(
      authReq.user.id,
      authReq.accessToken
    );

    res.json({
      success: true,
      data: licenses,
    });
  } catch (err) {
    next(err);
  }
}
