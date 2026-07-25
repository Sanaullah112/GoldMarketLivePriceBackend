// ============================================================
// middleware/validate.js  — Input validation helpers
// ============================================================
import { body, param, query, validationResult } from 'express-validator';

export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

export const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors,
];

export const validateRegister = [
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('phoneNumber').matches(/^(\+92|0)[0-9]{10}$/).withMessage('Valid Pakistani phone number required'),
  handleValidationErrors,
];

export const validateCreateAdmin = [
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('shopName').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('Shop name is required'),
  body('phoneNumber').optional().matches(/^(\+92|0)[0-9]{10}$/).withMessage('Valid Pakistani phone number required'),
  handleValidationErrors,
];

export const validatePriceDifference = [
  body('difference_24k').isNumeric().withMessage('24K difference must be a number'),
  body('difference_2385k').isNumeric().withMessage('23.85K difference must be a number'),
  handleValidationErrors,
];

export const validateOrder = [
  body('adminId').isMongoId().withMessage('Valid shop ID is required'),
  body('orderType').isIn(['buy', 'sell']).withMessage('Order type must be buy or sell'),
  body('metalType').isIn(['gold', 'silver', 'currency']).withMessage('Metal type must be gold, silver, or currency'),
  body('carat').isIn(['24k', '23.85k']).withMessage('Carat must be 24k or 23.85k'),
  body('quantity').isFloat({ min: 0.001 }).withMessage('Quantity must be a positive number'),
  body('unit').isIn(['tola', 'gram', 'USD', 'SAR', 'AED', 'EUR', 'GBP', 'CHF']).withMessage('Unit must be tola, gram, or a currency code'),
  body('paymentMethod').optional().isIn(['cash', 'bank', 'online']).withMessage('Invalid payment method'),
  handleValidationErrors,
];