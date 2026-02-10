import { Router } from 'express';
import { createPublisher, getMyPublisher, getMyPublisherSettings, updateMyPublisherSettings } from '../controllers/publisherController';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createPublisherSchema, updatePublisherSettingsSchema } from '../utils/validators';

const router = Router();

router.use(authMiddleware);

router.post('/', validate(createPublisherSchema), createPublisher);
router.get('/me', getMyPublisher);
router.get('/settings', getMyPublisherSettings);
router.put('/settings', validate(updatePublisherSettingsSchema), updateMyPublisherSettings);

export default router;
