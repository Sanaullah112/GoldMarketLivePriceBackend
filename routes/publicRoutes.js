// ============================================================
// routes/publicRoutes.js  — No authentication needed
// ============================================================
import express from 'express';
import { getHomePage, getLivePrices, getShopDetail, getPublicLivePrices, getPublicLivePriceStream, getPublicPictures, getSuperAdminPriceDifferences } from '../controllers/publicController.js';

const router = express.Router();

router.get('/', getHomePage);
router.get('/prices', getLivePrices);  
router.get('/shop/:id', getShopDetail);   // ← was missing
router.get('/live-prices', getPublicLivePrices);
router.get('/prices/stream', getPublicLivePriceStream);
router.get("/pictures", getPublicPictures);
router.get('/super-admin/price-differences', getSuperAdminPriceDifferences);

export default router;