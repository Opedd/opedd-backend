import { Router } from 'express';
import { createLicense, getMyLicenses } from '../controllers/licenseController';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createLicenseSchema } from '../utils/validators';

const router = Router();

router.use(authMiddleware);

router.post('/', validate(createLicenseSchema), createLicense);
router.get('/me', getMyLicenses);

export default router;
