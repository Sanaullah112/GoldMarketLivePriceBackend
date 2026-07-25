import express from 'express';
import { protect } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { validateRegister, validateOrder } from '../middleware/validate.js';
import {
  register,
  getAllShops,
  getShopById,
  placeOrder,
  getMyOrders,
  getOrderById,
  updateProfile,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getWhatsAppContact,
  getProfile,  
  registerWithShop,
  checkShopRegistration,
  // NEW FUNCTIONS - add these
  getUnreadCount,
  deleteNotification,
  deleteAllNotifications,
  deleteSelectedNotifications,
} from '../controllers/customerController.js';

const router = express.Router();

// Public
router.post('/register', authLimiter, validateRegister, register);

// Protected — any logged-in user can access these
router.use(protect);
router.get('/profile', getProfile);
router.put('/profile', updateProfile);

// Notification routes - UPDATED
router.get('/notifications', getNotifications);
router.get('/notifications/unread-count', getUnreadCount);  // NEW - for navbar badge
router.put('/notifications/:id/read', markNotificationRead);
router.put('/notifications/read-all', markAllNotificationsRead);
router.delete('/notifications/:id', deleteNotification);     // NEW - delete single
router.delete('/notifications', deleteAllNotifications);      // NEW - delete all
router.post('/notifications/delete-selected', deleteSelectedNotifications); // NEW - bulk delete

router.get('/orders', getMyOrders);
router.get('/orders/:id', getOrderById);
router.get('/shops', getAllShops);
router.get('/shops/:id', getShopById);
router.get('/shops/:id/whatsapp', getWhatsAppContact);

// Place order - any logged-in user can order (customer, admin, super_admin)
router.post('/orders', validateOrder, placeOrder);

router.post('/register-with-shop/:shopId', registerWithShop);
router.get('/check-registration/:shopId', checkShopRegistration);

export default router;