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

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const findUserByEmail = async (email) => {
  let user = await SuperAdmin.findOne({ email });
  if (user) return { user, role: 'super_admin' };

  user = await Admin.findOne({ email });
  if (user) return { user, role: 'admin' };

  user = await Customer.findOne({ email });
  if (user) return { user, role: 'customer' };

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

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const userData = await findUserByEmail(email);

    if (!userData) return res.status(401).json({ message: 'Invalid email or password' });

    const { user, role } = userData;

    // For admin and super admin only - check if active
    if (role !== 'customer' && user.isActive === false) {
      return res.status(401).json({ message: 'Account is deactivated. Contact super admin.' });
    }

    // For customers - only check if flagged (status and isActive removed)
    if (role === 'customer') {
      if (user.isFlagged === true) {
        return res.status(401).json({ message: 'Your account has been flagged. Please contact support.' });
      }
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });

    const token = generateToken(user._id, role);

    const userResponse = {
      id: user._id,
      name: user.name,
      email: user.email,
      role,
      isActive: user.isActive,
      ...(role === 'admin' && {
        shopName: user.shopName,
        shopLogo: user.shopLogo,
        phoneNumber: user.phoneNumber,
        diff_24k: user.diff_24k,
        diff_2385k: user.diff_2385k,
      }),
      ...(role === 'customer' && {
        phoneNumber: user.phoneNumber,
        whatsappNumber: user.whatsappNumber,
        isTrusted: user.isTrusted,
        isFlagged: user.isFlagged,
      }),
    };

    res.status(200).json({ success: true, message: 'Login successful', token, user: userResponse });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
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