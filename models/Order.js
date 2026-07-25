// ============================================================
// models/Order.js
// ============================================================
import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "adminModel",
      required: true,
    },
    adminModel: {
      type: String,
      enum: ["Admin", "SuperAdmin"],
      required: true,
      default: "Admin",
    },

    orderType:  { type: String, enum: ["buy", "sell"], required: true },
    metalType:  { type: String, enum: ["gold", "silver", "currency"], required: true },
    carat:      { type: String, enum: ["24k", "23.85k"], default: "24k" },

    // ── Quantity (canonical) ─────────────────────────────────────────────────
    quantity:       { type: Number, required: true, min: 0 },
    unit: {
      type: String,
      enum: ["tola", "masha", "ratti", "gram", "USD", "SAR", "AED", "EUR", "GBP", "CHF"],
      required: true,
    },

    // Normalised conversions (always stored regardless of input mode)
    quantityInTola: { type: Number, default: 0 },
    quantityInGram: { type: Number, default: 0 },

    // ── Traditional breakdown (Tola · Masha · Ratti) ────────────────────────
    quantityInMasha:  { type: Number, default: 0 },
    quantityInRatti:  { type: Number, default: 0 },

    // Human-readable string, e.g. "2T 3M 1Ra"
    quantityDisplay:  { type: String, default: null },

    // Input mode used by the customer
    inputMode: {
      type: String,
      enum: ["traditional", "simple"],
      default: "simple",
    },

    // ── Pricing snapshot at time of order ───────────────────────────────────
    marketPriceUSD:       { type: Number, required: true },
    dollarRatePKR:        { type: Number, required: true },
    basePricePerTolaPKR:  { type: Number, required: true },
    adminDiffPKR:         { type: Number, default: 0 },
    finalPricePerTolaPKR: { type: Number, required: true },
    totalAmount:          { type: Number, required: true },

    // ── Payment ──────────────────────────────────────────────────────────────
    paymentMethod: {
      type: String,
      enum: ["cash", "bank", "online"],
      default: "cash",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    paymentTime: { type: Date, default: null },

    // If payment is late, price is recalculated
    priceLocked:    { type: Boolean, default: false },
    lockedAt:       { type: Date, default: null },

    // ── Completion financials ────────────────────────────────────────────────
    // finalizedAmount = baseAmount + extraCharges - discount  (stored on completion)
    finalizedAmount: { type: Number, default: null },
    // The base amount the admin chose at completion time (may differ from totalAmount
    // if the admin fetched the current live price instead of using the original total)
    completionBaseAmount: { type: Number, default: null },
    // Extra charges added at completion (delivery, handling, etc.)
    extraCharges:    { type: Number, default: 0 },
    // Discount applied at completion
    discount:        { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "completed", "cancelled"],
      default: "pending",
    },

    notes:           { type: String, default: null },
    rejectionReason: { type: String, default: null },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    approvedAt:  { type: Date, default: null },
    completedAt: { type: Date, default: null },

    // Receipt data (generated after completion)
    receiptNumber: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);

// ── Auto-generate receipt number on completion ────────────────────────────────
orderSchema.pre("save", function (next) {
  if (
    this.isModified("status") &&
    this.status === "completed" &&
    !this.receiptNumber
  ) {
    this.receiptNumber = `GC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    this.completedAt = new Date();
  }
  next();
});

const Order = mongoose.model("Order", orderSchema);
export default Order;