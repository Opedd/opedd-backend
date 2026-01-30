import { Request, Response, NextFunction } from 'express';
import { CreateContentSourceUseCase } from '../use-cases/CreateContentSourceUseCase';
import { GetMyContentSourcesUseCase } from '../use-cases/GetMyContentSourcesUseCase';
import { SupabaseContentSourceRepo } from '../repos/ContentSourceRepo';
import { SupabaseLicenseRepo } from '../repos/LicenseRepo';
import { SupabasePublisherRepo } from '../repos/PublisherRepo';
import { GetMyLicensesUseCase } from '../use-cases/GetMyLicensesUseCase';
import { verifyPublication } from '../services/verificationService';
import { AuthenticatedRequest } from '../middleware/auth';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

const contentSourceRepo = new SupabaseContentSourceRepo();
const licenseRepo = new SupabaseLicenseRepo();
const publisherRepo = new SupabasePublisherRepo();
const createContentSourceUseCase = new CreateContentSourceUseCase(contentSourceRepo);
const getMyContentSourcesUseCase = new GetMyContentSourcesUseCase(contentSourceRepo);
const getMyLicensesUseCase = new GetMyLicensesUseCase(licenseRepo, publisherRepo);

export async function createContentSource(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const source = await createContentSourceUseCase.execute(
      req.body,
      authReq.user.id,
      authReq.accessToken
    );

    res.status(201).json({
      success: true,
      data: source,
    });
  } catch (err) {
    next(err);
  }
}

export async function getMyContentSources(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const sources = await getMyContentSourcesUseCase.execute(
      authReq.user.id,
      authReq.accessToken
    );

    res.json({
      success: true,
      data: sources,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /content-sources/me/assets
 *
 * Returns the authenticated user's licenses (assets) from the licenses
 * table, joined with content_sources on source_id.
 */
export async function getMyAssets(
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

/**
 * POST /content-sources/:id/verify
 *
 * Fetches the publication URL (trying /about first for Substack
 * compatibility, including custom domains) and checks whether the
 * verification_token appears in the page HTML.
 *
 * Updates the content source's verification_status to 'verified'
 * or 'failed' based on the result.
 */
export async function verifyContentSource(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const id = req.params.id as string;

    const source = await contentSourceRepo.findById(id, authReq.accessToken);
    if (!source) {
      throw new NotFoundError('Content source');
    }

    if (!source.verificationToken) {
      throw new NotFoundError('Verification token');
    }

    logger.info('Verifying content source', {
      sourceId: id,
      url: source.url,
      sourceType: source.sourceType,
    });

    const verified = await verifyPublication(
      source.url,
      source.verificationToken,
      source.sourceType
    );

    const newStatus = verified ? 'verified' : 'failed';
    const updated = await contentSourceRepo.updateVerificationStatus(
      id,
      newStatus,
      authReq.accessToken
    );

    logger.info('Content source verification result', {
      sourceId: id,
      status: newStatus,
    });

    res.json({
      success: true,
      data: {
        id: updated.id,
        verificationStatus: updated.verificationStatus,
        verified,
      },
    });
  } catch (err) {
    next(err);
  }
}
