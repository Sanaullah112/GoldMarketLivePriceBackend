// ============================================================
// routes/adminRoutes.js
// ============================================================
import express from 'express';
import { protect, adminOnly } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import {
  getDashboard,
  updatePriceDifference,
  updateShopSettings,
  getPendingCustomers,
  getAllCustomers,
  trustCustomer,
  untrustCustomer,
  flagCustomer,
  getOrders,
  approveOrder,
  rejectOrder,
  completeOrder,
  getOrderReceipt,
  uploadPicture,
  getPictures,
  getSharedPictures,
  deletePicture,
  getAnalytics,
  getNotifications,
  markNotificationRead,
  deleteNotification,
  markAllNotificationsRead,
  getWhatsAppLink,
  deleteOrder,
  deleteCustomer,
  addCustomer,
  updatePicture,
  getShopRegistrations,
  approveShopRegistration,
  rejectShopRegistration,
  unflagCustomer,
  getAdminLivePriceStream, 
} from '../controllers/adminController.js';

const router = express.Router();
router.use(protect, adminOnly);



router.get('/prices/stream', getAdminLivePriceStream); 

// Dashboard
router.get('/dashboard', getDashboard);

// Pricing
router.put('/price-difference', updatePriceDifference);

// Shop settings (with optional logo upload)
router.put('/settings', upload.single('logo'), updateShopSettings);

// Customer management
router.get('/customers/pending', getPendingCustomers);
router.get('/registrations', getShopRegistrations);
router.get('/customers', getAllCustomers);
router.post('/customers', addCustomer);
router.put('/customers/:id/trust', trustCustomer);
router.put('/customers/:id/untrust', untrustCustomer);

router.put('/customers/:id/flag', flagCustomer);
router.delete('/customers/:id', deleteCustomer);
router.put('/registrations/:id/approve', approveShopRegistration);
router.put('/registrations/:id/reject', rejectShopRegistration);
router.put('/customers/:id/unflag', unflagCustomer);

// Order management
router.get('/orders', getOrders);
router.put('/orders/:id/approve', approveOrder);
router.put('/orders/:id/reject', rejectOrder);
router.put('/orders/:id/complete', completeOrder);
router.get('/orders/:id/receipt', getOrderReceipt);
router.delete('/orders/:id', deleteOrder);

// Media
router.post('/pictures', uploadLimiter, upload.single('image'), uploadPicture);
router.get('/pictures', getPictures);
router.get('/pictures/shared', getSharedPictures);
router.delete('/pictures/:id', deletePicture);
router.put('/pictures/:id', updatePicture); 

// Analytics
router.get('/analytics', getAnalytics);


// Notifications
router.get('/notifications', getNotifications);
router.put('/notifications/:id/read', markNotificationRead);
router.put('/notifications/read-all', markAllNotificationsRead);
router.delete('/notifications/:id', deleteNotification); 

// WhatsApp
router.post('/whatsapp-link', getWhatsAppLink);

export default router;