import { Router } from 'express';
import {
  createContentSource,
  getMyContentSources,
  getMyAssets,
  verifyContentSource,
  regenerateToken,
  syncContentSource,
} from '../controllers/contentSourceController';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { contentSourceSchema } from '../utils/validators';

const router = Router();

router.use(authMiddleware);

router.post('/', validate(contentSourceSchema), createContentSource);
router.get('/me', getMyContentSources);
router.get('/me/assets', getMyAssets);
router.post('/:id/verify', verifyContentSource);
router.post('/:id/regenerate-token', regenerateToken);
router.post('/:id/sync', syncContentSource);

export default router;
