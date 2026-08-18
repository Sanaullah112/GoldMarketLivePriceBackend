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
  // Allow login with either email or mobile number
  body().custom((_, { req }) => {
    const identifier = req.body.number || req.body.email || req.body.phone || req.body.mobile;
    if (!identifier) throw new Error('Email or mobile number is required');
    // If it's numeric-ish treat as phone, otherwise validate email format
    const digitsOnly = String(identifier).replace(/\D/g, '');
    if (digitsOnly.length >= 7) {
      // basic phone check (allow +92 or 0 local formats)
      const phoneRe = /^(\+92|0)?[0-9]{10,12}$/;
      if (!phoneRe.test(String(identifier))) throw new Error('Valid mobile number is required');
    } else {
      // validate email
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(String(identifier))) throw new Error('Valid email is required');
    }
    return true;
  }),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors,
];

export const validateRegister = [
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('phoneNumber').matches(/^(\+92|0)[0-9]{10}$/).withMessage('Valid Pakistani phone number required'),
  body('email').optional().isEmail().withMessage('Valid email address'),
  handleValidationErrors,
];

export const validateCreateAdmin = [
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Name is required'),
  body('phoneNumber').matches(/^(\+92|92|0)?[0-9]{10}$/).withMessage('Valid Pakistani phone number required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('shopName').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('Shop name is required'),
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