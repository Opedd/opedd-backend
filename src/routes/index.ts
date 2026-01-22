import { Router } from 'express';
import authRoutes from './authRoutes';
import licenseRoutes from './licenseRoutes';
import publisherRoutes from './publisherRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/licenses', licenseRoutes);
router.use('/publishers', publisherRoutes);

export default router;
