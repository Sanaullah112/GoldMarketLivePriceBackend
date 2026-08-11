// ============================================================
// models/SuperAdmin.js
// ============================================================
import mongoose from 'mongoose';
import bcrypt   from 'bcryptjs';

const superAdminSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 8 },

  // ── Shop identity ─────────────────────────────────────────────────────────
  shopName:           { type: String, default: 'GOLDKING' },
  profilePicture:     { type: String, default: null },
  cloudinaryPublicId: { type: String, default: null },
  shopLogo:           { type: String, default: null },        
  shopLogoPublicId:   { type: String, default: null }, 

  // ── Contact & location ────────────────────────────────────────────────────
  phoneNumber:    { type: String, default: null }, 
  whatsappNumber: { type: String, default: null },
  address:        { type: String, default: null },
  city:           { type: String, default: null },

  // ── Status ────────────────────────────────────────────────────────────────
  isActive: { type: Boolean, default: true },

     // ── SINGLE ACTIVE SESSION ─────────────────────────────────
    // Only one browser/device can use this account at a time.
  activeSessionId: { type: String, default: null},

  // ── Gold sell price differences (customer buys from shop) ─────────────────
  diff_24k:    { type: Number, default: 0 },
  diff_2385k:  { type: Number, default: 0 },
  diff_silver: { type: Number, default: 0 },

  // ── Gold buy price differences (customer sells to shop) ───────────────────
  buy_diff_24k:    { type: Number, default: 0 },
  buy_diff_2385k:  { type: Number, default: 0 },
  buy_diff_silver: { type: Number, default: 0 },

  // ── Currency adjustments ──────────────────────────────────────────────────
  currencyDiff: {
    USD: { type: Number, default: 0 },
    SAR: { type: Number, default: 0 },
    AED: { type: Number, default: 0 },
    EUR: { type: Number, default: 0 },
    GBP: { type: Number, default: 0 },
    CHF: { type: Number, default: 0 },
  },
  currencyBuyDiff: {
    USD: { type: Number, default: 0 },
    SAR: { type: Number, default: 0 },
    AED: { type: Number, default: 0 },
    EUR: { type: Number, default: 0 },
    GBP: { type: Number, default: 0 },
    CHF: { type: Number, default: 0 },
  },

  // ── Analytics counters ────────────────────────────────────────────────────
  totalSales:     { type: Number, default: 0 },
  totalPurchases: { type: Number, default: 0 },
  salesCount:     { type: Number, default: 0 },
  purchasesCount: { type: Number, default: 0 },

  // ── Password reset ────────────────────────────────────────────────────────
  resetPasswordToken:   { type: String,  default: undefined },
  resetPasswordExpires: { type: Date,    default: undefined },
}, { timestamps: true });

superAdminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

superAdminSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

const SuperAdmin = mongoose.model('SuperAdmin', superAdminSchema);
export default SuperAdmin;