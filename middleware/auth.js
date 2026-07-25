// ============================================================
// middleware/auth.js
// ============================================================
import jwt from 'jsonwebtoken';
import SuperAdmin from '../models/SuperAdmin.js';
import Admin from '../models/Admin.js';
import Customer from '../models/Customer.js';

export const protect = async (req, res, next) => {
  let token;

  // Standard Bearer token from Authorization header
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  // SSE connections can't send headers — accept token via query param
  else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user;
    if (decoded.role === 'super_admin') {
      user = await SuperAdmin.findById(decoded.id).select('-password');
    } else if (decoded.role === 'admin') {
      user = await Admin.findById(decoded.id).select('-password');
    } else if (decoded.role === 'customer') {
      user = await Customer.findById(decoded.id).select('-password');
    }

    if (!user) return res.status(401).json({ message: 'Not authorized, user not found' });
    if (user.isActive === false && decoded.role !== 'customer') {
      return res.status(401).json({ message: 'Account is deactivated. Contact super admin.' });
    }

    req.user = { id: user._id, role: decoded.role, ...user.toObject() };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

export const superAdminOnly = (req, res, next) => {
  if (req.user?.role === 'super_admin') return next();
  res.status(403).json({ message: 'Access denied. Super admin only.' });
};

export const adminOnly = (req, res, next) => {
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ message: 'Access denied. Admin only.' });
};

export const adminOrSuperAdmin = (req, res, next) => {
  console.log('User role:', req.user?.role);
  if (req.user?.role === 'admin' || req.user?.role === 'super_admin') return next();
  res.status(403).json({ message: 'Access denied. Admin or Super Admin only.' });
};

export const customerOnly = (req, res, next) => {
  if (req.user?.role === 'customer') return next();
  res.status(403).json({ message: 'Access denied. Customer only.' });
};

export const activeCustomerOnly = (req, res, next) => {
  if (req.user?.role !== 'customer') return res.status(403).json({ message: 'Access denied.' });
  if (!req.user.isActive || req.user.status !== 'approved') {
    return res.status(403).json({ message: 'Your account is pending approval. Please wait for admin approval.' });
  }
  next();
};