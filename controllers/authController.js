// ============================================================
// controllers/authController.js
// ============================================================
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import SuperAdmin from '../models/SuperAdmin.js';
import Admin from '../models/Admin.js';
import Customer from '../models/Customer.js';

// ── Helpers ──────────────────────────────────────────────────

const generateToken = (id, role, sessionId) => {
  return jwt.sign({ id, role, sessionId }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const buildPhoneQuery = (phoneNumber) => {
  const cleanDigits = String(phoneNumber || '').replace(/\D/g, '');
  if (!cleanDigits) return null;
  const last10 = cleanDigits.slice(-10);
  if (last10.length === 10) {
    return { phoneNumber: new RegExp(`^(\\+92|92|0)?${last10}$`) };
  }
  return { phoneNumber: cleanDigits };
};

const findUserByIdentifier = async (identifier) => {
  if (!identifier) return null;

  const phoneQuery = buildPhoneQuery(identifier) || { phoneNumber: identifier.trim() };

  // ───────────────────────────────────────────────────────────
  // SUPER ADMIN
  // ───────────────────────────────────────────────────────────

  let user = null;

  if (identifier.includes('@')) {
    user = await SuperAdmin.findOne({
      email: identifier.toLowerCase().trim(),
    });
  }

  if (!user) {
    user = await SuperAdmin.findOne(phoneQuery);
  }

  if (user) {
    return {
      user,
      role: 'super_admin',
    };
  }

  // ───────────────────────────────────────────────────────────
  // ADMIN
  // ───────────────────────────────────────────────────────────

  user = await Admin.findOne(phoneQuery);

  if (user) {
    return {
      user,
      role: 'admin',
    };
  }

  // ───────────────────────────────────────────────────────────
  // CUSTOMER
  // ───────────────────────────────────────────────────────────

  if (identifier.includes('@')) {
    user = await Customer.findOne({
      email: identifier.toLowerCase().trim(),
    });
  }

  if (!user) {
    user = await Customer.findOne(phoneQuery);
  }

  if (user) {
    return {
      user,
      role: 'customer',
    };
  }

  return null;
};

console.log("EMAIL USER:", process.env.EMAIL_USER);
console.log("EMAIL PASS:", process.env.EMAIL_PASS ? "FOUND" : "MISSING");

console.log("Creating transporter...");

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  family: 4,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify((err, success) => {
  if (err) {
    console.log("SMTP ERROR:", err);
  } else {
    console.log("SMTP READY");
  } 
});

// ── Controllers ──────────────────────────────────────────────
// ============================================================
// LOGIN
// ============================================================

export const login = async (req, res) => {
  try {
    // ─────────────────────────────────────────────────────────
    // GET LOGIN DATA
    // ─────────────────────────────────────────────────────────

    const identifier =
      req.body.number ||
      req.body.email ||
      req.body.phone ||
      req.body.mobile;

    const password = req.body.password;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Phone/email and password are required.',
      });
    }


    // ─────────────────────────────────────────────────────────
    // FIND USER
    // ─────────────────────────────────────────────────────────

    const userData = await findUserByIdentifier(identifier);

    if (!userData) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    const { user, role } = userData;


    // ─────────────────────────────────────────────────────────
    // CHECK ACCOUNT STATUS
    // ─────────────────────────────────────────────────────────

    // Super Admin + Admin
    if (role !== 'customer' && user.isActive === false) {
      return res.status(401).json({
        success: false,
        message:
          'Account is deactivated. Contact super admin.',
      });
    }


    // Customer
    if (role === 'customer') {
      if (user.isFlagged === true) {
        return res.status(401).json({
          success: false,
          message:
            'Your account has been flagged. Please contact support.',
        });
      }
    }


    // ─────────────────────────────────────────────────────────
    // CHECK PASSWORD
    // ─────────────────────────────────────────────────────────

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }


    // ─────────────────────────────────────────────────────────
    // CREATE NEW SESSION ID
    // ─────────────────────────────────────────────────────────

    const sessionId = crypto.randomUUID();


    // ─────────────────────────────────────────────────────────
    // IMPORTANT:
    //
    // Only create the session if there is currently NO
    // active session.
    //
    // This prevents two devices from logging in at the
    // same time.
    // ─────────────────────────────────────────────────────────

    let updatedUser = null;


    if (role === 'super_admin') {

      updatedUser = await SuperAdmin.findOneAndUpdate(
        {
          _id: user._id,

          $or: [
            { activeSessionId: null },
            { activeSessionId: { $exists: false } },
          ],
        },
        {
          $set: {
            activeSessionId: sessionId,
          },
        },
        {
          new: true,
        }
      );

    } else if (role === 'admin') {

      updatedUser = await Admin.findOneAndUpdate(
        {
          _id: user._id,

          $or: [
            { activeSessionId: null },
            { activeSessionId: { $exists: false } },
          ],
        },
        {
          $set: {
            activeSessionId: sessionId,
          },
        },
        {
          new: true,
        }
      );

    } else if (role === 'customer') {

      updatedUser = await Customer.findOneAndUpdate(
        {
          _id: user._id,

          $or: [
            { activeSessionId: null },
            { activeSessionId: { $exists: false } },
          ],
        },
        {
          $set: {
            activeSessionId: sessionId,
          },
        },
        {
          new: true,
        }
      );
    }


    // ─────────────────────────────────────────────────────────
    // ACCOUNT IS ALREADY LOGGED IN
    // ─────────────────────────────────────────────────────────

    if (!updatedUser) {
      return res.status(409).json({
        success: false,
        code: 'ACCOUNT_ALREADY_LOGGED_IN',
        message:
          'This account is already logged in on another device or browser. Please logout from that device first.',
      });
    }


    // ─────────────────────────────────────────────────────────
    // GENERATE JWT
    // ─────────────────────────────────────────────────────────

    const token = generateToken(
      updatedUser._id,
      role,
      sessionId
    );


    // ─────────────────────────────────────────────────────────
    // USER RESPONSE
    // ─────────────────────────────────────────────────────────

    const userResponse = {
      id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email || null,
      role,
      isActive: updatedUser.isActive,
    };


    // ─────────────────────────────────────────────────────────
    // ADMIN DATA
    // ─────────────────────────────────────────────────────────

    if (role === 'admin') {
      userResponse.shopName = updatedUser.shopName;
      userResponse.shopLogo = updatedUser.shopLogo;
      userResponse.phoneNumber = updatedUser.phoneNumber;
      userResponse.diff_24k = updatedUser.diff_24k;
      userResponse.diff_2385k = updatedUser.diff_2385k;
    }


    // ─────────────────────────────────────────────────────────
    // CUSTOMER DATA
    // ─────────────────────────────────────────────────────────

    if (role === 'customer') {
      userResponse.phoneNumber =
        updatedUser.phoneNumber;

      userResponse.whatsappNumber =
        updatedUser.whatsappNumber;

      userResponse.isTrusted =
        updatedUser.isTrusted;

      userResponse.isFlagged =
        updatedUser.isFlagged;
    }


    // ─────────────────────────────────────────────────────────
    // SUCCESS
    // ─────────────────────────────────────────────────────────

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: userResponse,
    });

  } catch (error) {

    console.error('Login error:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

export const getCurrentUser = async (req, res) => {
  try {
    let user;
    if (req.user.role === 'super_admin') user = await SuperAdmin.findById(req.user.id).select('-password');
    else if (req.user.role === 'admin')  user = await Admin.findById(req.user.id).select('-password');
    else                                 user = await Customer.findById(req.user.id).select('-password');

    res.status(200).json({ success: true, user, role: req.user.role });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }

    let user;
    if (req.user.role === 'super_admin') user = await SuperAdmin.findById(req.user.id);
    else if (req.user.role === 'admin')  user = await Admin.findById(req.user.id);
    else                                 user = await Customer.findById(req.user.id);

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) return res.status(400).json({ message: 'Current password is incorrect' });

    user.password = newPassword;
    await user.save();

    res.status(200).json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const userData = await findUserByEmail(email);

    // Always 200 — prevents user enumeration attacks
    if (!userData) {
      return res.status(200).json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
    }

    const { user } = userData;

    // Generate raw token (sent in email) and hashed token (stored in DB)
    const rawToken    = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.resetPasswordToken   = hashedToken;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${rawToken}`;

    await transporter.sendMail({
      from: `"GOLDKING" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'GOLDKING — Password Reset Request',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#b8860b;margin-bottom:8px;">GOLDKING</h2>
          <p style="color:#374151;">You requested a password reset. Click the button below to choose a new password.</p>
          <a href="${resetUrl}"
             style="display:inline-block;margin:24px 0;padding:12px 28px;background:#b8860b;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
            Reset Password
          </a>
          <p style="color:#6b7280;font-size:13px;">This link expires in <strong>15 minutes</strong>.</p>
          <p style="color:#6b7280;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
          <p style="color:#9ca3af;font-size:12px;">GOLDKING &mdash; ${process.env.FRONTEND_URL}</p>
        </div>
      `,
    });

    res.status(200).json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Check all user types for a matching, non-expired token
    const models = [SuperAdmin, Admin, Customer];
    let matchedUser = null;

    for (const Model of models) {
      const user = await Model.findOne({
        resetPasswordToken:   hashedToken,
        resetPasswordExpires: { $gt: Date.now() },
      });
      if (user) { matchedUser = user; break; }
    }

    if (!matchedUser) {
      return res.status(400).json({ message: 'Reset link is invalid or has expired.' });
    }

    matchedUser.password             = newPassword;
    matchedUser.resetPasswordToken   = undefined;
    matchedUser.resetPasswordExpires = undefined;
    await matchedUser.save();

    res.status(200).json({ success: true, message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ============================================================
// LOGOUT CONTROLLER
// ============================================================

export const logout = async (req, res) => {
  try {
    // These values are added by the protect middleware
    const userId = req.userId;
    const role = req.role;
    const sessionId = req.sessionId;

    // ----------------------------------------------------------
    // Validate session information
    // ----------------------------------------------------------

    if (!userId || !role || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid session. Please login again.',
      });
    }

    // ----------------------------------------------------------
    // SUPER ADMIN
    // ----------------------------------------------------------

    if (role === 'super_admin') {
      await SuperAdmin.findOneAndUpdate(
        {
          _id: userId,
          activeSessionId: sessionId,
        },
        {
          $unset: {
            activeSessionId: 1
          }
        }
      );
    }

    // ----------------------------------------------------------
    // ADMIN
    // ----------------------------------------------------------

    else if (role === 'admin') {
      await Admin.findOneAndUpdate(
        {
          _id: userId,
          activeSessionId: sessionId,
        },
        {
          $set: {
            activeSessionId: null,
          },
        }
      );
    }

    // ----------------------------------------------------------
    // CUSTOMER
    // ----------------------------------------------------------

    else if (role === 'customer') {
      await Customer.findOneAndUpdate(
        {
          _id: userId,
          activeSessionId: sessionId,
        },
        {
          $set: {
            activeSessionId: null,
          },
        }
      );
    }

    // ----------------------------------------------------------
    // INVALID ROLE
    // ----------------------------------------------------------

    else {
      return res.status(400).json({
        success: false,
        message: 'Invalid user role.',
      });
    }

    // ----------------------------------------------------------
    // SUCCESS
    // ----------------------------------------------------------

    return res.status(200).json({
      success: true,
      message: 'Logout successful.',
    });

  } catch (error) {
    console.error('Logout error:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error during logout.',
      error: error.message,
    });
  }
};