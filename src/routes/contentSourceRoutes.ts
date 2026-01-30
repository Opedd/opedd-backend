import { Router } from 'express';
import {
  createContentSource,
  getMyContentSources,
  getMyAssets,
  verifyContentSource,
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

export default router;
