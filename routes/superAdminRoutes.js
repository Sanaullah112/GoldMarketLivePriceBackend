// ============================================================
// routes/superAdminRoutes.js
// ============================================================
import express from 'express';
import { protect, superAdminOnly, adminOrSuperAdmin } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { validateCreateAdmin } from '../middleware/validate.js';

import {
  getLivePriceStream,
  getDashboard,
  updatePriceDifference,
  updateSilverPriceDifference,
  getAllPrices,
  updateCurrency,
  createAdmin,
  getAllAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
  toggleAdminStatus,
  getSystemHealth,
  getAnalytics,
  getMyShopAnalytics,
  getAllOrders,
  getAllCustomers,
  uploadPicture,
  updatePicture,
  getPictures,
  deletePicture,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification, 
  updateProfile,
  updateOrderStatus,
  updateCustomerStatus,
  getMyOrders,
  deleteOrder,
  getMyCustomers,
  trustCustomerForSA,
  untrustCustomerForSA,
  flagCustomerForSA,
  unflagCustomerForSA,
  getCustomerWithDetails,
  getCustomerOrders,
} from '../controllers/superAdminController.js';
import { getShopRegistrations, approveShopRegistration, rejectShopRegistration } from '../controllers/adminController.js';


const router = express.Router();

router.get(
  '/prices/stream',
  protect,
  superAdminOnly,
  (req, res, next) => {
    // Prevent reverse proxies from buffering
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-transform');
    next();
  },
  getLivePriceStream
);

router.use(protect); 

// ── Dashboard ─────────────────────────────────────
router.get('/dashboard', adminOrSuperAdmin, getDashboard);

// ── Price Management ──────────────────────────────

router.get('/all-prices', adminOrSuperAdmin, getAllPrices);
router.put('/price-difference', superAdminOnly, updatePriceDifference);
router.put('/silver-price-difference', updateSilverPriceDifference);
router.put('/currency/:currency', updateCurrency);

// ── Admin Management ──────────────────────────────
router.post('/admins', validateCreateAdmin, createAdmin);
router.get('/admins', getAllAdmins);
router.get('/admins/:id', getAdminById);
router.put('/admins/:id', updateAdmin);
router.delete('/admins/:id', deleteAdmin);
router.patch('/admins/:id/toggle-status', toggleAdminStatus);

// Add this line after your dashboard route
router.get('/system-health', getSystemHealth);

// ── Analytics ─────────────────────────────────────
router.get('/analytics', getAnalytics);
router.get('/analytics/my-shop', getMyShopAnalytics);

// ── Orders ────────────────────────────────────────
router.get('/orders/my', getMyOrders); 
router.get('/orders', getAllOrders);
router.patch('/orders/:id/status', updateOrderStatus);
router.delete('/orders/:id', deleteOrder); 

// ── Customers ─────────────────────────────────────
router.get('/customers/my', getMyCustomers);
router.get('/registrations', getShopRegistrations);
router.get('/customers', getAllCustomers);
router.patch('/customers/:id/status', updateCustomerStatus);
router.get('/customers/:id/details', getCustomerWithDetails);
router.get('/customers/:id/orders', getCustomerOrders);
// Shop Registrations (for SA's own shop)

router.put('/registrations/:id/approve', approveShopRegistration);
router.put('/registrations/:id/reject', rejectShopRegistration);
router.put('/customers/:id/unflag', unflagCustomerForSA);

// ── Pictures ──────────────────────────────────────
router.post(
  '/pictures',
  uploadLimiter,
  upload.single('image'),
  uploadPicture
);
router.get('/pictures', getPictures);
router.delete('/pictures/:id', deletePicture);
router.put('/pictures/:id', upload.single('image'), updatePicture);

// ── Notifications ─────────────────────────────────
router.get('/notifications', getNotifications);
router.put('/notifications/:id/read', markNotificationRead);
router.put('/notifications/read-all', markAllNotificationsRead);

router.delete('/notifications/:id', superAdminOnly, deleteNotification);

// ── Profile ───────────────────────────────────────
router.put('/profile', upload.single('logo'), updateProfile);


router.put('/customers/:id/trust', trustCustomerForSA);
router.put('/customers/:id/untrust', untrustCustomerForSA);
router.put('/customers/:id/flag', flagCustomerForSA);

export default router;