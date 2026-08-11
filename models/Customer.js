// ============================================================
// models/Customer.js
// ============================================================
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    password: { type: String, required: true, minlength: 8 },
    phoneNumber: { type: String, required: true },
    email: { type: String, default: null, lowercase: true, trim: true, unique: true, sparse: true },
    whatsappNumber: { type: String, default: null },
    address: { type: String, default: null },
    city: { type: String, default: null },
    profilePicture: { type: String, default: null },

    // Trust system — admin can mark customers
    isTrusted: { type: Boolean, default: false }, // Trusted = skip approval for future orders
    isFlagged: { type: Boolean, default: false }, // Flagged as scam
    flaggedBy: {
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Admin",
      default: null,
    },
    flagReason: { type: String, default: null },

    // NEW: Per-shop trust/flag status - each admin has their own entry
    shopRelations: [{
      adminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
      isTrusted: { type: Boolean, default: false },
      isFlagged: { type: Boolean, default: false },
      flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
      flagReason: { type: String, default: null },
    }],

    shopCustomerNumbers: [{
     adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
     number:  { type: String },           // e.g. "SC-A3F2-0001"
     seq:     { type: Number },           // sequential number
  }],

    // Relationship — which admin's shop this customer primarily deals with
    primaryAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    // Track which admin added this customer
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    // Stats
    totalOrders: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
     // ── SINGLE ACTIVE SESSION ─────────────────────────────────
    // Only one browser/device can use this customer account.
    activeSessionId: {type: String, default: null },
    // Password reset
    resetPasswordToken:   { type: String, default: undefined },
    resetPasswordExpires: { type: Date,   default: undefined },

  },
  { timestamps: true },
);

customerSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

customerSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

const Customer = mongoose.model("Customer", customerSchema);
export default Customer;