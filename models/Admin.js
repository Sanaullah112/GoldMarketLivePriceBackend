// ============================================================
// models/Admin.js
// ============================================================
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // email: { type: String, required: false, unique: false, lowercase: true, trim: true, default: null },
  password: { type: String, required: true, minlength: 8 },
  shopName: { type: String, required: true, trim: true },
  shopLogo: { type: String, default: null },
  shopLogoPublicId: { type: String, default: null },
  phoneNumber: { type: String, required: true ,default: null },
  whatsappNumber: { type: String, default: null }, 
  address: { type: String, default: null },
  city: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  tolaWeight: { type: Number, enum: [11.664, 12.150], default: 11.664 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin', required: true },
     // ── SINGLE ACTIVE SESSION ─────────────────────────────────
    // Only one browser/device can use this admin account.
  activeSessionId: { type: String, default: null },

  // ── Sell price differences (customer buys from shop) ──────────────────────
  diff_24k: { type: Number, default: 0 },
  diff_2385k: { type: Number, default: 0 }, 
  diff_silver: { type: Number, default: 0 },

  // ── Buy price differences (customer sells to shop) ────────────────────────
  buy_diff_24k: { type: Number, default: 0 },
  buy_diff_2385k: { type: Number, default: 0 },
  buy_diff_silver: { type: Number, default: 0 },

  // ── Currency adjustments (admin adds on top of SA rate) ───────────────────
  // Sell-side currency diff
  currencyDiff: {
    USD: { type: Number, default: 0 },
    SAR: { type: Number, default: 0 },
    AED: { type: Number, default: 0 },
    EUR: { type: Number, default: 0 },
    GBP: { type: Number, default: 0 },
    CHF: { type: Number, default: 0 },
  },
  // Buy-side currency diff (new)
  currencyBuyDiff: {
    USD: { type: Number, default: 0 },
    SAR: { type: Number, default: 0 },
    AED: { type: Number, default: 0 },
    EUR: { type: Number, default: 0 },
    GBP: { type: Number, default: 0 },
    CHF: { type: Number, default: 0 },
  },

  // ── Analytics counters ────────────────────────────────────────────────────
  totalSales: { type: Number, default: 0 },
  totalPurchases: { type: Number, default: 0 },
  salesCount: { type: Number, default: 0 },
  purchasesCount: { type: Number, default: 0 },

  // ── Password reset ────────────────────────────────────────────────────────
  resetPasswordToken: { type: String, default: undefined },
  resetPasswordExpires: { type: Date, default: undefined },
}, { timestamps: true });

adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

adminSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

const Admin = mongoose.model('Admin', adminSchema);
export default Admin;