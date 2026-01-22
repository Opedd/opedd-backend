import { Router } from 'express';
import authRoutes from './authRoutes';
import licenseRoutes from './licenseRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/licenses', licenseRoutes);

export default router;
