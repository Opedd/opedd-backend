import { Router } from 'express';
import { createPublisher } from '../controllers/publisherController';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createPublisherSchema } from '../utils/validators';

const router = Router();

router.use(authMiddleware);

router.post('/', validate(createPublisherSchema), createPublisher);

export default router;
