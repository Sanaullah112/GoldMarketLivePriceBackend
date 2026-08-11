// ============================================================
// routes/authRoutes.js
// ============================================================
import express from 'express';
import {
  login,
  getCurrentUser,
  changePassword,
  forgotPassword,
  resetPassword,
  logout,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { validateLogin } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

router.post('/login',           authLimiter, validateLogin, login);
router.get('/me',               protect, getCurrentUser);
router.put('/change-password',  protect, changePassword);
router.post('/forgot-password', authLimiter, forgotPassword);   // ← new
router.post('/reset-password/:token', resetPassword);  
router.post('/logout', protect, logout);         // ← new

export default router;