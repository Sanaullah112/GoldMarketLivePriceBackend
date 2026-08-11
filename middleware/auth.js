// ============================================================
// middleware/auth.js
// ============================================================

import jwt from 'jsonwebtoken';

import SuperAdmin from '../models/SuperAdmin.js';
import Admin from '../models/Admin.js';
import Customer from '../models/Customer.js';


export const protect = async (req, res, next) => {
  let token;


  // ==========================================================
  // GET TOKEN FROM AUTHORIZATION HEADER
  // ==========================================================

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token =
      req.headers.authorization.split(' ')[1];
  }


  // ==========================================================
  // SSE TOKEN
  // ==========================================================

  else if (req.query.token) {
    token = req.query.token;
  }


  // ==========================================================
  // NO TOKEN
  // ==========================================================

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token',
    });
  }


  try {

    // ========================================================
    // VERIFY JWT
    // ========================================================

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );


    // ========================================================
    // SESSION ID MUST EXIST
    // ========================================================

    if (!decoded.sessionId) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_INVALID',
        message:
          'Session is invalid. Please login again.',
      });
    }


    let user;


    // ========================================================
    // SUPER ADMIN
    // ========================================================

    if (decoded.role === 'super_admin') {

      user = await SuperAdmin.findOne({
        _id: decoded.id,
        activeSessionId: decoded.sessionId,
      }).select('-password');

    }


    // ========================================================
    // ADMIN
    // ========================================================

    else if (decoded.role === 'admin') {

      user = await Admin.findOne({
        _id: decoded.id,
        activeSessionId: decoded.sessionId,
      }).select('-password');

    }


    // ========================================================
    // CUSTOMER
    // ========================================================

    else if (decoded.role === 'customer') {

      user = await Customer.findOne({
        _id: decoded.id,
        activeSessionId: decoded.sessionId,
      }).select('-password');

    }


    // ========================================================
    // INVALID ROLE
    // ========================================================

    else {
      return res.status(401).json({
        success: false,
        message: 'Invalid user role',
      });
    }


    // ========================================================
    // SESSION DOES NOT MATCH
    // ========================================================

    if (!user) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REVOKED',
        message:
          'Your session is no longer active. Please login again.',
      });
    }


    // ========================================================
    // ADMIN / SUPER ADMIN ACTIVE CHECK
    // ========================================================

    if (
      decoded.role !== 'customer' &&
      user.isActive === false
    ) {
      return res.status(401).json({
        success: false,
        message:
          'Account is deactivated. Contact super admin.',
      });
    }


    // ========================================================
    // CUSTOMER FLAG CHECK
    // ========================================================

    if (
      decoded.role === 'customer' &&
      user.isFlagged === true
    ) {
      return res.status(401).json({
        success: false,
        message:
          'Your account has been flagged. Please contact support.',
      });
    }


    // ========================================================
    // SAVE USER TO REQUEST
    // ========================================================

    req.user = {
      id: user._id,
      role: decoded.role,
      ...user.toObject(),
    };

    req.userId = user._id;
    req.role = decoded.role;
    req.sessionId = decoded.sessionId;


    next();

  } catch (error) {

    console.error(
      'Auth middleware error:',
      error
    );

    return res.status(401).json({
      success: false,
      message: 'Not authorized, token failed',
    });
  }
};


// ============================================================
// ROLE MIDDLEWARE
// ============================================================

export const superAdminOnly = (req, res, next) => {
  if (req.user?.role === 'super_admin') {
    return next();
  }

  return res.status(403).json({
    message:
      'Access denied. Super admin only.',
  });
};


export const adminOnly = (req, res, next) => {
  if (req.user?.role === 'admin') {
    return next();
  }

  return res.status(403).json({
    message:
      'Access denied. Admin only.',
  });
};


export const adminOrSuperAdmin = (req, res, next) => {

  if (
    req.user?.role === 'admin' ||
    req.user?.role === 'super_admin'
  ) {
    return next();
  }

  return res.status(403).json({
    message:
      'Access denied. Admin or Super Admin only.',
  });
};


export const customerOnly = (req, res, next) => {

  if (req.user?.role === 'customer') {
    return next();
  }

  return res.status(403).json({
    message:
      'Access denied. Customer only.',
  });
};


export const activeCustomerOnly = (req, res, next) => {

  if (req.user?.role !== 'customer') {
    return res.status(403).json({
      message: 'Access denied.',
    });
  }

  if (
    !req.user.isActive ||
    req.user.status !== 'approved'
  ) {
    return res.status(403).json({
      message:
        'Your account is pending approval. Please wait for admin approval.',
    });
  }

  next();
};