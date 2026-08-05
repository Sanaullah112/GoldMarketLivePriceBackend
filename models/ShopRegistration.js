// models/ShopRegistration.js
import mongoose from 'mongoose';

const shopRegistrationSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
  },
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'shopModel',
    required: true,
  },
  shopModel: {
    type: String,
    enum: ['Admin', 'SuperAdmin'],
    required: true,
  },
  // Customer details at time of registration (snapshot)
  name: { type: String, required: true, trim: true },
  email: { type: String, required: false, lowercase: true, trim: true, default: null },
  phoneNumber: { type: String, required: true },
  whatsappNumber: { type: String, default: null },
  address: { type: String, default: null },
  city: { type: String, default: null },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
  },
  approvedAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null },
  
  // Policy agreement
  policyAgreed: { type: Boolean, default: false },
  policyAgreedAt: { type: Date, default: null },
  
  // Registration metadata
  registeredAt: { type: Date, default: Date.now },
  ipAddress: { type: String, default: null },
}, { timestamps: true });

// Compound index: one registration per customer per shop
shopRegistrationSchema.index({ customerId: 1, shopId: 1 }, { unique: true });

// Index for shop to query their registrations
shopRegistrationSchema.index({ shopId: 1, status: 1 });

const ShopRegistration = mongoose.model('ShopRegistration', shopRegistrationSchema);
export default ShopRegistration;