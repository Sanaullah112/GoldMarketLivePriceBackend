// ============================================================
// routes/publicRoutes.js  — No authentication needed
// ============================================================
import express from 'express';
import { getHomePage, getLivePrices, getShopDetail, getPublicLivePrices, getPublicLivePriceStream  } from '../controllers/publicController.js';

const router = express.Router();

router.get('/', getHomePage);
router.get('/prices', getLivePrices);
router.get('/shop/:id', getShopDetail);   // ← was missing
router.get('/live-prices', getPublicLivePrices); 
router.get('/prices/stream', getPublicLivePriceStream); 

export default router;