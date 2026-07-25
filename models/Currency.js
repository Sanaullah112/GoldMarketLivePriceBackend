// ============================================================
// models/Currency.js
// ============================================================
import mongoose from 'mongoose';

const currencySchema = new mongoose.Schema({
  currency: { 
    type: String, 
    enum: ['USD', 'SAR', 'AED', 'EUR', 'GBP', 'CNY'], 
    required: true, 
    unique: true 
  },
  name: { type: String, required: true },
  symbol: { type: String, required: true },
  liveRatePKR: { type: Number, required: true },   // Live from API
  
  // Sell side (customer buys currency from shop)
  difference: { type: Number, default: 0 },         // SA-applied sell diff
  adjustedRate: { type: Number, required: true },   // liveRate + difference (sell rate)
  
  // Buy side (customer sells currency to shop) - NEW FIELDS
  buy_difference: { type: Number, default: 0 },     // SA-applied buy diff
  buyRate: { type: Number, default: 0 },            // liveRate + buy_difference (buy rate)
  
  changePercent: { type: Number, default: 0 },      // 24h change %
  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
}, { timestamps: true });

const Currency = mongoose.model('Currency', currencySchema);
export default Currency;