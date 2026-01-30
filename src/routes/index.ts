import { Router } from 'express';
import authRoutes from './authRoutes';
import licenseRoutes from './licenseRoutes';
import publisherRoutes from './publisherRoutes';
import contentSourceRoutes from './contentSourceRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/licenses', licenseRoutes);
router.use('/publishers', publisherRoutes);
router.use('/content-sources', contentSourceRoutes);

export default router;
