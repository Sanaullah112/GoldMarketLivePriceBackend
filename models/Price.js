// models/Price.js
import mongoose from 'mongoose';

const priceSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['gold', 'silver'],
      required: true,
    },

    // ── Shared ─────────────────────────────────────────────────────────────
    originalPriceUSD:    { type: Number, required: true },
    dollarRatePKR:       { type: Number, required: true },
    basePricePerTolaPKR: { type: Number, required: true },
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'SuperAdmin',
    },

    // ── Gold sell ──────────────────────────────────────────────────────────
    diff_24k:            { type: Number, default: 0 },
    diff_2385k:          { type: Number, default: 0 },
    adjustedPrice_24k:   { type: Number },
    adjustedPrice_2385k: { type: Number },

    // ── Gold buy (new) ─────────────────────────────────────────────────────
    buy_diff_24k:              { type: Number, default: 0 },
    buy_diff_2385k:            { type: Number, default: 0 },
    adjustedBuyPrice_24k:      { type: Number },
    adjustedBuyPrice_2385k:    { type: Number },

    // ── Silver sell ────────────────────────────────────────────────────────
    diff_silver:          { type: Number, default: 0 },
    adjustedPrice_silver: { type: Number },

    // ── Silver buy (new) ───────────────────────────────────────────────────
    buy_diff_silver:          { type: Number, default: 0 },
    adjustedBuyPrice_silver:  { type: Number },
  },
  { timestamps: true }
);

const Price = mongoose.model('Price', priceSchema);
export default Price;