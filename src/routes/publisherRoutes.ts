import { Router } from 'express';
import { createPublisher, getMyPublisher } from '../controllers/publisherController';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createPublisherSchema } from '../utils/validators';

const router = Router();

router.use(authMiddleware);

router.post('/', validate(createPublisherSchema), createPublisher);
router.get('/me', getMyPublisher);

export default router;
