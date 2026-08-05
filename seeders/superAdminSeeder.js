// ============================================================
// seeders/SuperAdminSeeder.js
// ============================================================
import mongoose from 'mongoose';
import dotenv   from 'dotenv';
import SuperAdmin   from '../models/SuperAdmin.js';
import connectDB    from '../config/database.js';

dotenv.config();

const createSuperAdmin = async () => {
  try {
    await connectDB();

    const number = process.env.SA_NUMBER || process.env.SA_PHONE || null;
    const email = process.env.SA_EMAIL || null;

    let existing = null;
    if (number) existing = await SuperAdmin.findOne({ phoneNumber: number });
    if (!existing && email) existing = await SuperAdmin.findOne({ email });
    if (existing) {
      console.log('✅ Super Admin already exists:', existing.phoneNumber || existing.email);
      process.exit(0);
    }

    const sa = await SuperAdmin.create({
      // ── Identity ────────────────────────────────────────────────────────────
      name:     process.env.SA_NAME     || 'Super Admin',
      email: email || undefined,
      password: process.env.SA_PASSWORD || 'SuperAdmin@123!',

      // ── Shop identity ────────────────────────────────────────────────────────
      shopName:           process.env.SA_SHOP_NAME || 'GOLDKING',
      profilePicture:     null,
      cloudinaryPublicId: null,
      shopLogo:           null,
      shopLogoPublicId:   null,

      // ── Contact & location ───────────────────────────────────────────────────
      phoneNumber:    number || process.env.SA_PHONE || null,
      whatsappNumber: process.env.SA_WHATSAPP  || number || null,
      address:        process.env.SA_ADDRESS   || null,
      city:           process.env.SA_CITY      || null,

      // ── Status ───────────────────────────────────────────────────────────────
      isActive: true,

      // ── Gold sell price differences (customer buys from shop) ────────────────
      diff_24k:    0,
      diff_2385k:  0,
      diff_silver: 0,

      // ── Gold buy price differences (customer sells to shop) ──────────────────
      buy_diff_24k:    0,
      buy_diff_2385k:  0,
      buy_diff_silver: 0,

      // ── Currency sell adjustments ────────────────────────────────────────────
      currencyDiff: {
        USD: 0,
        SAR: 0,
        AED: 0,
        EUR: 0,
        GBP: 0,
        CHF: 0,              // ← ADD THIS LINE
      },

      // ── Currency buy adjustments ─────────────────────────────────────────────
        currencyBuyDiff: {
        USD: 0,
        SAR: 0,
        AED: 0,
        EUR: 0,
        GBP: 0,
        CHF: 0,              // ← ADD THIS LINE
      },
      
      // ── Analytics counters ───────────────────────────────────────────────────
      totalSales:     0,
      totalPurchases: 0,
      salesCount:     0,
      purchasesCount: 0,

      // ── Password reset (leave unset) ─────────────────────────────────────────
      resetPasswordToken:   undefined,
      resetPasswordExpires: undefined,
    });

    console.log('\n✅ Super Admin created successfully!');
    console.log('─────────────────────────────────────');
    console.log(`  Name      : ${sa.name}`);
    console.log(`  Number    : ${sa.phoneNumber || '—'}`);
    console.log(`  Password  : ${process.env.SA_PASSWORD || 'SuperAdmin@123!'}`);
    console.log(`  Shop Name : ${sa.shopName}`);
    console.log(`  Active    : ${sa.isActive}`);
    console.log(`  Created   : ${sa.createdAt}`);
    console.log('─────────────────────────────────────');
    console.log('\n⚠️  CHANGE YOUR PASSWORD AFTER FIRST LOGIN!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeder error:', error.message);
    process.exit(1);
  }
};

createSuperAdmin();