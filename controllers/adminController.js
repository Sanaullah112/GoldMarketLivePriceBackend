// ============================================================
// controllers/adminController.js
// ============================================================
import Admin from '../models/Admin.js';
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import Order from '../models/Order.js';
import Picture from '../models/Picture.js';
import Notification from '../models/Notification.js';
import Currency from '../models/Currency.js';
import ShopRegistration from '../models/ShopRegistration.js';
import { cloudinaryDeleteImage } from '../middleware/upload.js';
import {
  fetchAllPrices,
  fetchGoldPriceUSD,
  fetchDollarRatePKR,
  calculatePricePerTola,
  applyPriceDifference,
  convertQuantity,
  calculateTotalPrice,
} from '../utils/goldPriceCalculator.js';
import {
  generateWhatsAppLink,
  whatsAppTemplates,
  formatWhatsAppNumber,
} from '../utils/whatsapp.js';
import { generateReceipt } from '../utils/receiptGenerator.js';
import { sendWhatsAppFromShop } from '../services/whatsappService.js';

// ── Supported currencies ──────────────────────────────────
const SUPPORTED_CURRENCIES = ['USD', 'SAR', 'AED', 'EUR', 'GBP', 'CHF'];

// ── DASHBOARD ─────────────────────────────────────────────
export const getDashboard = async (req, res) => {
  try {
    const adminId = req.user.id;
    const [livePrices, admin, currencies] = await Promise.all([
      fetchAllPrices(),
      Admin.findById(adminId).populate('createdBy', 'name email'),
      Currency.find(),
    ]);

    const currencyMap = {};
    currencies.forEach(c => { currencyMap[c.currency] = c; });

    const basePKR_24k    = livePrices.gold.pricePerTolaPKR;
    const base2385       = Math.round((basePKR_24k * (23.85 / 24)) * 100) / 100;
    const basePKR_silver = livePrices.silver.pricePerTolaPKR;

    // Get orders with approved or completed status to find active customers
    const [pendingOrders, totalOrders, approvedOrders, completedOrders] = await Promise.all([
      Order.countDocuments({ adminId, status: 'pending' }),
      Order.countDocuments({ adminId }),
      Order.countDocuments({ adminId, status: 'approved' }),
      Order.countDocuments({ adminId, status: 'completed' }),
    ]);

    // Get unique customer IDs from approved AND completed orders
    const orderCustomers = await Order.aggregate([
      { 
        $match: { 
          adminId: new mongoose.Types.ObjectId(adminId),
          status: { $in: ['approved', 'completed'] }
        } 
      },
      { $group: { _id: '$customerId' } },
      { $group: { _id: null, customers: { $addToSet: '$_id' } } }
    ]);
    
    const activeCustomerIds = orderCustomers[0]?.customers || [];
    const totalCustomers = activeCustomerIds.length;

    // Get trusted customers from the Customer collection (based on isTrusted flag)
    const trustedCustomers = await Customer.countDocuments({
      _id: { $in: activeCustomerIds },
      isTrusted: true
    });

    // Get flagged customers from the Customer collection (based on isFlagged flag)
    const flaggedCustomers = await Customer.countDocuments({
      _id: { $in: activeCustomerIds },
      isFlagged: true
    });

    const pendingCustomers = 0; // No pending customers needed anymore

    // ── Build currency entries ────────────────────────────
    // Admin's rates are: pure live rate + admin's OWN diff only.
    // The SA diff belongs to the SA's shop only — it does NOT apply to admin shops.
    const currencyEntries = Object.fromEntries(
      Object.entries(livePrices.currencies).map(([code, data]) => {
        // Pure live rate from exchange API (no SA adjustments)
        const liveRate = data.rate;

        // Admin's own sell/buy diffs — default to 0 safely
        const adminDiff    = Number(admin.currencyDiff?.[code]    ?? 0) || 0;
        const adminBuyDiff = Number(admin.currencyBuyDiff?.[code] ?? 0) || 0;

        // Admin's final rates = live + admin's own diff only
        const adjustedRate = liveRate + adminDiff;
        const buyRate      = liveRate + adminBuyDiff;

        return [code, {
          ...data,
          liveRate,        // raw live rate
          adjustedRate,    // admin sell rate (live + adminDiff)
          buyRate,         // admin buy rate (live + adminBuyDiff)
          adminDiff,       // admin's own sell diff (for display)
          adminBuyDiff,    // admin's own buy diff (for display)
        }];
      })
    );

    res.status(200).json({
      success: true,
      livePrices: {
        gold: {
          priceUSD:               livePrices.gold.priceUSD,
          basePricePerTola_24k:   basePKR_24k,
          basePricePerTola_2385k: base2385,

          // Sell prices (customer buys from shop)
          myPrice_24k:   applyPriceDifference(basePKR_24k, admin.diff_24k   ?? 0),
          myPrice_2385k: applyPriceDifference(base2385,    admin.diff_2385k ?? 0),
          diff_24k:      admin.diff_24k   ?? 0,
          diff_2385k:    admin.diff_2385k ?? 0,

          // Buy prices (customer sells to shop)
          myBuyPrice_24k:   applyPriceDifference(basePKR_24k, admin.buy_diff_24k   ?? 0),
          myBuyPrice_2385k: applyPriceDifference(base2385,    admin.buy_diff_2385k ?? 0),
          buy_diff_24k:     admin.buy_diff_24k   ?? 0,
          buy_diff_2385k:   admin.buy_diff_2385k ?? 0,
        },
        silver: {
          priceUSD:         livePrices.silver.priceUSD,
          basePricePerTola: basePKR_silver,

          // Sell
          myPrice:     applyPriceDifference(basePKR_silver, admin.diff_silver    ?? 0),
          diff_silver: admin.diff_silver ?? 0,

          // Buy
          myBuyPrice:      applyPriceDifference(basePKR_silver, admin.buy_diff_silver ?? 0),
          buy_diff_silver: admin.buy_diff_silver ?? 0,
        },
        currencies: currencyEntries,
        lastUpdated: livePrices.timestamp,
      },
      shopInfo: {
        _id:            admin._id,
        shopName:       admin.shopName,
        shopLogo:       admin.shopLogo,
        phoneNumber:    admin.phoneNumber,
        whatsappNumber: admin.whatsappNumber,
        address:        admin.address,
        city:           admin.city,
        name:           admin.name,
        email:          admin.email,
        createdBy:      admin.createdBy ? { name: admin.createdBy.name, email: admin.createdBy.email } : null,
      },
      stats: { 
        pendingOrders, 
        pendingCustomers,
        totalCustomers, 
        totalOrders, 
        trustedCustomers, 
        flaggedCustomers,
        approvedOrders,
        completedOrders
      },
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── PRICE DIFFERENCE ──────────────────────────────────────
export const updatePriceDifference = async (req, res) => {
  try {
    const {
      diff_24k, diff_2385k, diff_silver,
      buy_diff_24k, buy_diff_2385k, buy_diff_silver,
      currencyDiff,
      currencyBuyDiff,
    } = req.body;

    const admin = await Admin.findById(req.user.id);

    // Sell diffs
    if (diff_24k       !== undefined) admin.diff_24k       = Number(diff_24k);
    if (diff_2385k     !== undefined) admin.diff_2385k     = Number(diff_2385k);
    if (diff_silver    !== undefined) admin.diff_silver    = Number(diff_silver);

    // Buy diffs
    if (buy_diff_24k    !== undefined) admin.buy_diff_24k    = Number(buy_diff_24k);
    if (buy_diff_2385k  !== undefined) admin.buy_diff_2385k  = Number(buy_diff_2385k);
    if (buy_diff_silver !== undefined) admin.buy_diff_silver = Number(buy_diff_silver);

    // Currency sell diffs (all 5)
    if (currencyDiff && typeof currencyDiff === 'object') {
      for (const code of SUPPORTED_CURRENCIES) {
        if (currencyDiff[code] !== undefined) {
          admin.currencyDiff[code] = Number(currencyDiff[code]);
        }
      }
    }

    // Currency buy diffs (all 5)
    if (currencyBuyDiff && typeof currencyBuyDiff === 'object') {
      for (const code of SUPPORTED_CURRENCIES) {
        if (currencyBuyDiff[code] !== undefined) {
          admin.currencyBuyDiff[code] = Number(currencyBuyDiff[code]);
        }
      }
    }

    await admin.save();

    res.status(200).json({
      success: true,
      message: 'Price differences updated',
      data: {
        diff_24k:        admin.diff_24k,
        diff_2385k:      admin.diff_2385k,
        diff_silver:     admin.diff_silver,
        buy_diff_24k:    admin.buy_diff_24k,
        buy_diff_2385k:  admin.buy_diff_2385k,
        buy_diff_silver: admin.buy_diff_silver,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const updateShopSettings = async (req, res) => {
  try {
    const { name, shopName, phoneNumber, whatsappNumber, address, city, removeLogo } = req.body;
    const admin = await Admin.findById(req.user.id);
    if (!admin) return res.status(404).json({ message: 'Admin not found.' });

    if (name !== undefined) admin.name = name.trim();
    if (shopName !== undefined) admin.shopName = shopName.trim();
    if (phoneNumber !== undefined) admin.phoneNumber = phoneNumber.trim();
    if (whatsappNumber !== undefined) admin.whatsappNumber = whatsappNumber.trim();
    if (address !== undefined) admin.address = address.trim();
    if (city !== undefined) admin.city = city.trim();

    // Handle logo removal
    if (removeLogo === 'true') {
      if (admin.shopLogoPublicId) {
        await cloudinaryDeleteImage(admin.shopLogoPublicId);
      }
      admin.shopLogo = null;
      admin.shopLogoPublicId = null;
    }
    // Handle logo upload
    else if (req.file) {
      if (admin.shopLogoPublicId) {
        await cloudinaryDeleteImage(admin.shopLogoPublicId);
      }
      admin.shopLogo = req.file.path;
      admin.shopLogoPublicId = req.file.filename;
    }

    await admin.save();
    res.status(200).json({
      success: true,
      message: 'Shop settings updated',
      shop: {
        shopName:    admin.shopName,
        shopLogo:    admin.shopLogo,
        phoneNumber: admin.phoneNumber,
        address:     admin.address,
        city:        admin.city,
      },
      user: admin
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── CUSTOMER MANAGEMENT ───────────────────────────────────
export const getPendingCustomers = async (req, res) => {
  try {
    const customers = await Customer.find({ primaryAdminId: req.user.id, status: 'pending' }).select('-password');
    res.status(200).json({ success: true, count: customers.length, customers });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── CUSTOMER MANAGEMENT ───────────────────────────────────
// Note: Customer registration is now automatic. No approval needed.
// Admins can only trust or flag customers, and delete them.

// ── CUSTOMER MANAGEMENT ───────────────────────────────────
export const getAllCustomers = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { isTrusted, isFlagged, page = 1, limit = 20 } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    const pageLimit = Number(limit);
    
    // Step 1: Get paginated approved registrations for this admin
    const registrations = await ShopRegistration.find({
      shopId: adminId,
      status: 'approved'
    })
      .populate('customerId', '-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit);
    
    // Step 2: Get total count
    const total = await ShopRegistration.countDocuments({
      shopId: adminId,
      status: 'approved'
    });
    
    if (registrations.length === 0) {
      return res.status(200).json({
        success: true,
        total: 0,
        page: Number(page),
        pages: 0,
        customers: [],
      });
    }
    
    // Step 3: Get customer IDs
    const customerIds = registrations
      .map(reg => reg.customerId?._id || reg.customerId)
      .filter(id => id);
    
    // Step 4: Get ONLY COMPLETED orders stats for these customers
    let orderAggs = [];
    if (customerIds.length > 0) {
      orderAggs = await Order.aggregate([
        { 
          $match: { 
            adminId: new mongoose.Types.ObjectId(adminId),
            customerId: { $in: customerIds },
            status: 'completed'  // ← ONLY COMPLETED ORDERS
          } 
        },
        {
          $group: {
            _id: '$customerId',
            totalOrders: { $sum: 1 },
            buyOrders: { $sum: { $cond: [{ $eq: ['$orderType', 'buy'] }, 1, 0] } },
            sellOrders: { $sum: { $cond: [{ $eq: ['$orderType', 'sell'] }, 1, 0] } },
            totalSpent: { $sum: { $ifNull: ['$finalizedAmount', '$totalAmount'] } },
            lastOrderDate: { $max: '$createdAt' },
          },
        },
      ]);
    }
    
    const aggMap = {};
    orderAggs.forEach(a => { aggMap[a._id.toString()] = a; });
    
    // Step 5: Build customer list with per-shop trust/flag status
    const customers = registrations.map(reg => {
      const customer = reg.customerId;
      if (!customer) return null;
      
      const agg = aggMap[customer._id.toString()] || {};
      const customerObj = customer.toObject();
      
      // Get shop-specific trust/flag for this admin
      let isTrustedStatus = false;
      let isFlaggedStatus = false;
      let flagReason = null;
      
      if (customerObj.shopRelations) {
        const relation = customerObj.shopRelations.find(r => r.adminId.toString() === adminId);
        if (relation) {
          isTrustedStatus = relation.isTrusted || false;
          isFlaggedStatus = relation.isFlagged || false;
          flagReason = relation.flagReason || null;
        }
      }
      
      // Get shop customer number
      const shopCustomerNumber = customer.shopCustomerNumbers?.find(
        n => n.adminId.toString() === adminId
      )?.number || null;
      
      return {
        _id: customer._id,
        name: customer.name,
        email: customer.email,
        phoneNumber: customer.phoneNumber,
        whatsappNumber: customer.whatsappNumber,
        address: customer.address,
        city: customer.city,
        createdAt: customer.createdAt,
        totalOrders: agg.totalOrders || 0,
        buyOrders: agg.buyOrders || 0,
        sellOrders: agg.sellOrders || 0,
        totalSpent: agg.totalSpent || 0,
        lastOrderDate: agg.lastOrderDate || null,
        shopCustomerNumber: shopCustomerNumber,
        isTrusted: isTrustedStatus,
        isFlagged: isFlaggedStatus,
        flagReason: flagReason,
      };
    }).filter(c => c !== null);
    
    // Apply filters
    let filteredCustomers = customers;
    if (isTrusted === 'true') {
      filteredCustomers = customers.filter(c => c.isTrusted === true);
    }
    if (isFlagged === 'true') {
      filteredCustomers = customers.filter(c => c.isFlagged === true);
    }
    
    res.status(200).json({
      success: true,
      total: total,
      page: Number(page),
      pages: Math.ceil(total / pageLimit),
      customers: filteredCustomers,
    });
  } catch (error) {
    console.error('getAllCustomers error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


export const trustCustomer = async (req, res) => {
  try {
    const adminId = req.user.id;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const admin = await Admin.findById(adminId);
    const adminIdStr = adminId.toString();
    
    const otherRelations = customer.shopRelations.filter(
      r => r.adminId.toString() !== adminIdStr
    );
    
    customer.shopRelations = [
      ...otherRelations,
      {
        adminId: adminId,
        isTrusted: true,
        isFlagged: false,
        flaggedBy: null,
        flagReason: null
      }
    ];
    
    await customer.save();

    // ── SEND WHATSAPP MESSAGE FROM SHOP NUMBER ──
    let whatsappResult = null;
    if (customer.whatsappNumber || customer.phoneNumber) {
      const customerPhone = customer.whatsappNumber || customer.phoneNumber;
      const shopName = admin?.shopName || 'the shop';
      const message = whatsAppTemplates.trustedGranted(customer.name, shopName);
      
      whatsappResult = await sendWhatsAppFromShop(
        customerPhone,
        message,
        admin?.whatsappNumber || admin?.phoneNumber
      );
    }

    // ── CREATE IN-APP NOTIFICATION ──
    await Notification.create({
      userId: customer._id,
      userModel: 'Customer',
      title: 'Trusted Customer Status Granted! ⭐',
      message: `${admin?.shopName || 'The shop'} has marked you as a trusted customer. Your orders will now be auto-approved!`,
      type: 'customer_trusted',
      data: { adminId: req.user.id, shopName: admin?.shopName },
    });

    res.status(200).json({ 
      success: true, 
      message: 'Customer marked as trusted.',
      whatsappLink: whatsappResult?.link || null,
      whatsappSent: whatsappResult?.success || false,
    });
  } catch (error) {
    console.error('trustCustomer error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const untrustCustomer = async (req, res) => {
  try {
    const adminId = req.user.id;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const admin = await Admin.findById(adminId);
    const adminIdStr = adminId.toString();
    
    const otherRelations = customer.shopRelations.filter(
      r => r.adminId.toString() !== adminIdStr
    );
    
    const shopRelations = customer.shopRelations.filter(
      r => r.adminId.toString() === adminIdStr
    );
    
    if (shopRelations.length > 0) {
      const lastRel = shopRelations[shopRelations.length - 1];
      lastRel.isTrusted = false;
      
      customer.shopRelations = [...otherRelations, lastRel];
    }
    
    await customer.save();

    // ── SEND WHATSAPP MESSAGE FROM SHOP NUMBER ──
    let whatsappResult = null;
    if (customer.whatsappNumber || customer.phoneNumber) {
      const customerPhone = customer.whatsappNumber || customer.phoneNumber;
      const shopName = admin?.shopName || 'the shop';
      const message = whatsAppTemplates.trustedRemoved(customer.name, shopName);
      
      whatsappResult = await sendWhatsAppFromShop(
        customerPhone,
        message,
        admin?.whatsappNumber || admin?.phoneNumber
      );
    }

    // ── CREATE IN-APP NOTIFICATION ──
    await Notification.create({
      userId: customer._id,
      userModel: 'Customer',
      title: 'Trusted Status Updated',
      message: `${admin?.shopName || 'The shop'} has removed your trusted status. Orders will now require approval.`,
      type: 'customer_untrusted',
      data: { adminId: req.user.id, shopName: admin?.shopName },
    });

    res.status(200).json({ 
      success: true, 
      message: 'Trusted status removed from customer.',
      whatsappLink: whatsappResult?.link || null,
      whatsappSent: whatsappResult?.success || false,
    });
  } catch (error) {
    console.error('untrustCustomer error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const flagCustomer = async (req, res) => {
  try {
    const { reason } = req.body;
    const adminId = req.user.id;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const admin = await Admin.findById(adminId);
    const adminIdStr = adminId.toString();
    
    const otherRelations = customer.shopRelations.filter(
      r => r.adminId.toString() !== adminIdStr
    );
    
    customer.shopRelations = [
      ...otherRelations,
      {
        adminId: adminId,
        isTrusted: false,
        isFlagged: true,
        flaggedBy: adminId,
        flagReason: reason || 'Flagged as potential scam'
      }
    ];
    
    await customer.save();

    // ── SEND WHATSAPP MESSAGE FROM SHOP NUMBER ──
    let whatsappResult = null;
    if (customer.whatsappNumber || customer.phoneNumber) {
      const customerPhone = customer.whatsappNumber || customer.phoneNumber;
      const shopName = admin?.shopName || 'the shop';
      const message = whatsAppTemplates.flaggedAsScam(customer.name, shopName, reason);
      
      whatsappResult = await sendWhatsAppFromShop(
        customerPhone,
        message,
        admin?.whatsappNumber || admin?.phoneNumber
      );
    }

    // ── NOTIFY SUPER ADMINS ──
    const SAs = await (await import('../models/SuperAdmin.js')).default.find();
    for (const sa of SAs) {
      await Notification.create({
        userId: sa._id,
        userModel: 'SuperAdmin',
        title: 'Customer Flagged as Scam',
        message: `${admin?.shopName || 'A shop'} flagged customer ${customer.name} as scam. Reason: ${reason || 'Not specified'}`,
        type: 'customer_flagged',
        data: { customerId: customer._id, adminId: req.user.id },
      });
    }

    // ── CREATE IN-APP NOTIFICATION FOR CUSTOMER ──
    await Notification.create({
      userId: customer._id,
      userModel: 'Customer',
      title: 'Account Flagged ⚠️',
      message: `Your account has been flagged by ${admin?.shopName || 'the shop'}. Reason: ${reason || 'Not specified'}. You can no longer place orders with this shop.`,
      type: 'customer_flagged',
      data: { adminId: req.user.id, reason: reason || 'Not specified', shopName: admin?.shopName },
    });

    res.status(200).json({ 
      success: true, 
      message: 'Customer flagged as scam and deactivated',
      whatsappLink: whatsappResult?.link || null,
      whatsappSent: whatsappResult?.success || false,
    });
  } catch (error) {
    console.error('flagCustomer error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const deleteCustomer = async (req, res) => {
  try {
    const customerId = req.params.id;
    const adminId    = req.user.id;

    const customer = await Customer.findOne({ _id: customerId, primaryAdminId: adminId });
    if (!customer) return res.status(404).json({ message: 'Customer not found or you do not have permission to delete them' });

    const orderCount = await Order.countDocuments({ customerId });
    if (orderCount > 0) {
      return res.status(400).json({ message: `Cannot delete customer because they have ${orderCount} order(s). Delete the orders first.` });
    }

    await Customer.deleteOne({ _id: customerId });
    res.status(200).json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── ADD CUSTOMER (Admin adds customer manually) ────────────
export const addCustomer = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { name, phoneNumber, whatsappNumber, address, city, password, isTrusted } = req.body;

    // Validate required fields
    if (!name || !phoneNumber || !password) {
      return res.status(400).json({ message: 'Name, phone number, and password are required' });
    }

    // Check if phone number already exists
    const existingCustomer = await Customer.findOne({ phoneNumber: phoneNumber.trim() });
    if (existingCustomer) {
      return res.status(400).json({ message: 'Phone number already registered' });
    }

    // Create new customer
    const emailToUse = req.body.email?.trim()?.toLowerCase() || `no-email+${Date.now()}@${adminId}.local`;

    const newCustomer = await Customer.create({
      name: name.trim(),
      email: emailToUse,
      phoneNumber: phoneNumber.trim(),
      whatsappNumber: whatsappNumber?.trim() || null,
      address: address?.trim() || null,
      city: city?.trim() || null,
      password, // Will be hashed by pre-save hook
      addedBy: adminId, // Track which admin added this customer
      primaryAdminId: adminId,
    });

    // Create ShopRegistration record to associate customer with admin's shop
    const registration = new ShopRegistration({
      customerId: newCustomer._id,
      shopId: adminId,
      shopModel: 'Admin',
      name: newCustomer.name,
      email: newCustomer.email,
      phoneNumber: newCustomer.phoneNumber,
      whatsappNumber: newCustomer.whatsappNumber,
      address: newCustomer.address,
      city: newCustomer.city,
      status: 'approved', // Auto-approve since admin added them
    });
    await registration.save();

    // If isTrusted is true, mark them as trusted in shopRelations
    if (isTrusted) {
      newCustomer.shopRelations = [{
        adminId: adminId,
        isTrusted: true,
        isFlagged: false,
      }];
      await newCustomer.save();
    }

    res.status(201).json({
      success: true,
      message: 'Customer added successfully',
      customer: {
        _id: newCustomer._id,
        name: newCustomer.name,
        phoneNumber: newCustomer.phoneNumber,
        whatsappNumber: newCustomer.whatsappNumber,
        address: newCustomer.address,
        city: newCustomer.city,
        addedBy: newCustomer.addedBy,
      },
    });
  } catch (error) {
    console.error('addCustomer error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── ORDER MANAGEMENT ──────────────────────────────────────
export const getOrders = async (req, res) => {
  try {
    const { status, orderType, page = 1, limit = 20 } = req.query;
    const query = { adminId: req.user.id };
    
    // If status is not specified, default to only completed for revenue
    // But for order list view, we want all statuses
    if (status) {
      query.status = status;
    }
    // Don't filter by status if not specified - show all orders
    
    if (orderType) query.orderType = orderType;

    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('customerId', 'name phoneNumber whatsappNumber shopRelations')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Order.countDocuments(query),
    ]);

    res.status(200).json({ success: true, total, page: Number(page), pages: Math.ceil(total / Number(limit)), orders });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


export const approveOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, adminId: req.user.id });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'pending') return res.status(400).json({ message: 'Order is not in pending state' });

    order.status = 'approved';
    order.approvedBy = req.user.id;
    order.approvedAt = new Date();
    await order.save();

    const [customer, admin] = await Promise.all([
      Customer.findById(order.customerId),
      Admin.findById(req.user.id),
    ]);

    // ── SEND WHATSAPP MESSAGE FROM SHOP NUMBER ──
    let whatsappResult = null;
    if (customer && (customer.whatsappNumber || customer.phoneNumber)) {
      const customerPhone = customer.whatsappNumber || customer.phoneNumber;
      const shopName = admin?.shopName || 'the shop';
      const message = whatsAppTemplates.orderApproved(customer.name, shopName, {
        orderType: order.orderType,
        metalType: order.metalType,
        carat: order.carat,
        quantity: order.quantity,
        unit: order.unit,
        totalAmount: order.totalAmount,
      });
      
      whatsappResult = await sendWhatsAppFromShop(
        customerPhone,
        message,
        admin?.whatsappNumber || admin?.phoneNumber
      );
    }

    // ── CREATE IN-APP NOTIFICATION ──
    await Notification.create({
      userId: order.customerId,
      userModel: 'Customer',
      title: 'Order Approved! ✅',
      message: `Your ${order.orderType} order for ${order.quantity} ${order.unit} of ${order.metalType} has been approved by ${admin?.shopName || 'the shop'}.`,
      type: 'order',
      data: { orderId: order._id, shopName: admin?.shopName },
    });

    res.status(200).json({
      success: true,
      message: 'Order approved',
      whatsappLink: whatsappResult?.link || null,
      whatsappSent: whatsappResult?.success || false,
      order,
    });
  } catch (error) {
    console.error('approveOrder error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
export const rejectOrder = async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findOne({ _id: req.params.id, adminId: req.user.id });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'pending') return res.status(400).json({ message: 'Order is not in pending state' });

    order.status          = 'rejected';
    order.rejectionReason = reason || 'Rejected by shop';
    await order.save();

    const customer = await Customer.findById(order.customerId);
    await Notification.create({
      userId:    order.customerId,
      userModel: 'Customer',
      title:     'Order Rejected',
      message:   `Your order has been rejected. Reason: ${reason || 'Please contact the shop for details.'}`,
      type:      'order',
      data:      { orderId: order._id },
    });

    res.status(200).json({
      success: true,
      message: 'Order rejected',
      whatsappLink: generateWhatsAppLink(
        customer.whatsappNumber || customer.phoneNumber,
        whatsAppTemplates.orderRejected(customer.name, reason)
      ),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const completeOrder = async (req, res) => {
  try {
    const { paymentReceived, finalizedAmount, extraCharges, discount, completionBaseAmount } = req.body;
    const order = await Order.findOne({ _id: req.params.id, adminId: req.user.id });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'approved') return res.status(400).json({ message: 'Order must be approved before completing' });

    // Save all completion data
    order.status = 'completed';
    order.paymentStatus = paymentReceived ? 'paid' : 'pending';
    order.paymentTime = new Date();
    order.finalizedAmount = finalizedAmount || order.totalAmount;
    order.completionBaseAmount = completionBaseAmount || order.totalAmount;
    order.extraCharges = extraCharges || 0;
    order.discount = discount || 0;
    order.priceLocked = true;
    order.lockedAt = new Date();
    await order.save();

    // Update admin totals
    const admin = await Admin.findById(req.user.id);
    if (order.orderType === 'sell') {
      admin.totalPurchases += order.finalizedAmount;
      admin.purchasesCount += 1;
    } else {
      admin.totalSales += order.finalizedAmount;
      admin.salesCount += 1;
    }
    await admin.save();

    const customer = await Customer.findById(order.customerId);
    let receipt = null;
    let whatsappLink = null;

    // Generate receipt (safe)
    try {
      receipt = generateReceipt(order, admin, customer);
    } catch (err) {
      console.error('Receipt generation error:', err);
    }

    // Create in‑app notification (safe)
    try {
      await Notification.create({
        userId: order.customerId,
        userModel: 'Customer',
        title: 'Transaction Completed!',
        message: `Your transaction (Receipt: ${order.receiptNumber}) has been completed. Total: PKR ${order.finalizedAmount.toLocaleString()}`,
        type: 'order',
        data: { orderId: order._id, receiptNumber: order.receiptNumber },
      });
    } catch (err) {
      console.error('Notification error:', err);
    }

    // Generate WhatsApp link (safe)
    try {
      const customerPhone = customer?.whatsappNumber || customer?.phoneNumber;
      if (customerPhone) {
        const message = whatsAppTemplates.orderCompleted(customer.name, order.receiptNumber, order.finalizedAmount);
        whatsappLink = generateWhatsAppLink(customerPhone, message);
      }
    } catch (err) {
      console.error('WhatsApp link error:', err);
    }

    // Always return success – order is already completed
    res.status(200).json({
      success: true,
      message: 'Order completed',
      receipt,
      whatsappLink,
    });
  } catch (error) {
    console.error('completeOrder error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getOrderReceipt = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, adminId: req.user.id });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'completed') return res.status(400).json({ message: 'Receipt only available for completed orders' });

    const [admin, customer] = await Promise.all([
      Admin.findById(req.user.id),
      Customer.findById(order.customerId),
    ]);

    const receipt = generateReceipt(order, admin, customer);
    res.status(200).json({ success: true, receipt });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const deleteOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, adminId: req.user.id });
    if (!order) return res.status(404).json({ message: 'Order not found or you do not have permission to delete it' });
    if (order.status === 'completed') return res.status(400).json({ message: 'Cannot delete completed orders' });

    await Order.deleteOne({ _id: req.params.id });
    res.status(200).json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── PICTURE MANAGEMENT ────────────────────────────────────
export const uploadPicture = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Please upload an image file' });
    const { title, description, type, weight, weightUnit, price, showOnHomePage, showToAdmins } = req.body;

    const picture = await Picture.create({
      uploadedBy:         req.user.id,
      uploaderModel:      'Admin',
      imageUrl:           req.file.path,
      cloudinaryPublicId: req.file.filename,
      title:              title       || null,
      description:        description || null,
      type:               type        || 'gold',
      weight:             weight      ? Number(weight) : null,
      weightUnit:         weightUnit  || 'gram',  // ← ADD THIS LINE
      price:              price       ? Number(price)  : null,
      showOnHomePage:     showOnHomePage !== 'false',
      showToAdmins:       showToAdmins   !== 'false',
    });

    res.status(201).json({ success: true, message: 'Picture uploaded', picture });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getPictures = async (req, res) => {
  try {
    const pictures = await Picture.find({ uploadedBy: req.user.id, uploaderModel: 'Admin', isActive: true })
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: pictures.length, pictures });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getSharedPictures = async (req, res) => {
  try {
    const pictures = await Picture.find({ showToAdmins: true, isActive: true })
      .populate('uploadedBy', 'shopName name')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: pictures.length, pictures });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const deletePicture = async (req, res) => {
  try {
    const picture = await Picture.findOne({ _id: req.params.id, uploadedBy: req.user.id });
    if (!picture) return res.status(404).json({ message: 'Picture not found' });
    await cloudinaryDeleteImage(picture.cloudinaryPublicId);
    picture.isActive = false;
    await picture.save();
    res.status(200).json({ success: true, message: 'Picture deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const updatePicture = async (req, res) => {
  try {
    const { title, description, type, weight, weightUnit, price, showOnHomePage, showToAdmins } = req.body;
    const picture = await Picture.findOne({ _id: req.params.id, uploadedBy: req.user.id, uploaderModel: 'Admin' });
    if (!picture) return res.status(404).json({ message: 'Picture not found or you do not have permission to edit it' });

    if (title          !== undefined) picture.title          = title || null;
    if (description    !== undefined) picture.description    = description || null;
    if (type           !== undefined) picture.type           = type;
    if (weight         !== undefined) picture.weight         = weight ? Number(weight) : null;
    if (weightUnit     !== undefined) picture.weightUnit     = weightUnit;  // ← ADD THIS LINE
    if (price          !== undefined) picture.price          = price ? Number(price)  : null;
    if (showOnHomePage !== undefined) picture.showOnHomePage = showOnHomePage;
    if (showToAdmins   !== undefined) picture.showToAdmins   = showToAdmins;

    // ADD THIS: Handle new image file replacement
    if (req.file) {
      if (picture.cloudinaryPublicId) {
        await cloudinaryDeleteImage(picture.cloudinaryPublicId);
      }
      picture.imageUrl = req.file.path;
      picture.cloudinaryPublicId = req.file.filename;
    }

    await picture.save();
    res.status(200).json({ success: true, message: 'Picture updated successfully', picture });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── ADMIN ANALYTICS ───────────────────────────────────────
export const getAnalytics = async (req, res) => {
  try {
    const adminId = req.user.id;
    const admin   = await Admin.findById(adminId);
    const now     = new Date();
 
    // ── Time boundaries ────────────────────────────────────────────────────────
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
 
    const startOfWeek  = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay()); // Sunday
 
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
 
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);
 
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
 
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);
 
    const adminObjId = new mongoose.Types.ObjectId(adminId);
 
    // ── Customer counts ────────────────────────────────────────────────────────
    const orderCustomers = await Order.aggregate([
      {
        $match: {
          adminId: adminObjId,
          status: { $in: ['approved', 'completed'] },
        },
      },
      { $group: { _id: '$customerId' } },
    ]);
    const activeCustomerIds = orderCustomers.map(c => c._id);
    const totalCustomers    = activeCustomerIds.length;
 
    const [trustedCustomers, flaggedCustomers] = await Promise.all([
      Customer.countDocuments({ _id: { $in: activeCustomerIds }, isTrusted: true }),
      Customer.countDocuments({ _id: { $in: activeCustomerIds }, isFlagged: true }),
    ]);
 
    // ── All-time order counts ──────────────────────────────────────────────────
   
const [
  totalOrders, pendingOrders, approvedOrders, completedOrders, rejectedOrders, cancelledOrders,
] = await Promise.all([
  Order.countDocuments({ adminId }),
  Order.countDocuments({ adminId, status: 'pending'   }),
  Order.countDocuments({ adminId, status: 'approved'  }),
  Order.countDocuments({ adminId, status: 'completed' }),
  Order.countDocuments({ adminId, status: 'rejected'  }),
  Order.countDocuments({ adminId, status: 'cancelled' }),
]);
 
// ── Period order counts (daily / weekly / monthly) ─────────────────────────
const [
  dailyCompleted, dailyPending,   dailyApproved,   dailyRejected,   dailyCancelled,
  weeklyCompleted,weeklyPending,  weeklyApproved,  weeklyRejected,  weeklyCancelled,
  monthlyCompleted,monthlyPending,monthlyApproved, monthlyRejected, monthlyCancelled,
] = await Promise.all([
  // Daily
  Order.countDocuments({ adminId, status: 'completed', createdAt: { $gte: startOfToday } }),
  Order.countDocuments({ adminId, status: 'pending',   createdAt: { $gte: startOfToday } }),
  Order.countDocuments({ adminId, status: 'approved',  createdAt: { $gte: startOfToday } }),
  Order.countDocuments({ adminId, status: 'rejected',  createdAt: { $gte: startOfToday } }),
  Order.countDocuments({ adminId, status: 'cancelled', createdAt: { $gte: startOfToday } }),
  // Weekly
  Order.countDocuments({ adminId, status: 'completed', createdAt: { $gte: startOfWeek } }),
  Order.countDocuments({ adminId, status: 'pending',   createdAt: { $gte: startOfWeek } }),
  Order.countDocuments({ adminId, status: 'approved',  createdAt: { $gte: startOfWeek } }),
  Order.countDocuments({ adminId, status: 'rejected',  createdAt: { $gte: startOfWeek } }),
  Order.countDocuments({ adminId, status: 'cancelled', createdAt: { $gte: startOfWeek } }),
  // Monthly
  Order.countDocuments({ adminId, status: 'completed', createdAt: { $gte: startOfMonth } }),
  Order.countDocuments({ adminId, status: 'pending',   createdAt: { $gte: startOfMonth } }),
  Order.countDocuments({ adminId, status: 'approved',  createdAt: { $gte: startOfMonth } }),
  Order.countDocuments({ adminId, status: 'rejected',  createdAt: { $gte: startOfMonth } }),
  Order.countDocuments({ adminId, status: 'cancelled', createdAt: { $gte: startOfMonth } }),
]);
 
    // ── Revenue aggregation helper ─────────────────────────────────────────────
    const revenueAgg = async (dateFilter = {}) => {
      const match = { adminId: adminObjId, status: 'completed', ...dateFilter };
      const result = await Order.aggregate([
        { $match: match },
        {
          $group: {
            _id:     null,
            total:   { $sum: { $ifNull: ['$finalizedAmount', '$totalAmount'] } },
            count:   { $sum: 1 },
            // "buy" orderType = customer buys from shop = shop's SELL revenue
            sellRev: {
              $sum: {
                $cond: [
                  { $eq: ['$orderType', 'buy'] },
                  { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                  0,
                ],
              },
            },
            // "sell" orderType = customer sells to shop = shop's BUY revenue
            buyRev: {
              $sum: {
                $cond: [
                  { $eq: ['$orderType', 'sell'] },
                  { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                  0,
                ],
              },
            },
          },
        },
      ]);
      return result[0] ?? { total: 0, count: 0, sellRev: 0, buyRev: 0 };
    };
 
    const [dailyRevAgg, weeklyRevAgg, monthlyRevAgg] = await Promise.all([
      revenueAgg({ createdAt: { $gte: startOfToday } }),
      revenueAgg({ createdAt: { $gte: startOfWeek  } }),
      revenueAgg({ createdAt: { $gte: startOfMonth } }),
    ]);

    // ── All-time revenue aggregation ─────────────────────────────────────────
const allTimeRevenue = await Order.aggregate([
  {
    $match: {
      adminId: adminObjId,
      status: 'completed',
    },
  },
  {
    $group: {
      _id: null,
      totalSales: {
        $sum: {
          $cond: [
            { $eq: ['$orderType', 'buy'] },
            { $ifNull: ['$finalizedAmount', '$totalAmount'] },
            0,
          ],
        },
      },
      totalPurchases: {
        $sum: {
          $cond: [
            { $eq: ['$orderType', 'sell'] },
            { $ifNull: ['$finalizedAmount', '$totalAmount'] },
            0,
          ],
        },
      },
      salesCount: {
        $sum: { $cond: [{ $eq: ['$orderType', 'buy'] }, 1, 0] },
      },
      purchasesCount: {
        $sum: { $cond: [{ $eq: ['$orderType', 'sell'] }, 1, 0] },
      },
    },
  },
]);

// ADD THESE 2 LINES:
const allTimeRev = allTimeRevenue[0] || {
  totalSales: 0,
  totalPurchases: 0,
  salesCount: 0,
  purchasesCount: 0,
};
const totalRevenueAllTime = allTimeRev.totalSales + allTimeRev.totalPurchases;

    // ── Monthly trend (last 6 months) ──────────────────────────────────────────
    const [recentOrders, monthlyTrend] = await Promise.all([
      Order.find({ adminId })
        .populate('customerId', 'name phoneNumber')
        .sort({ createdAt: -1 })
        .limit(10),
      Order.aggregate([
        {
          $match: {
            adminId: adminObjId,
            createdAt: { $gte: sixMonthsAgo },
          },
        },
        {
          $group: {
            _id:     { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count:   { $sum: 1 },
            revenue: { $sum: { $ifNull: ['$finalizedAmount', '$totalAmount'] } },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ]);
 
    // ── Weekly sales vs buys (last 7 days, completed only) ────────────────────
    const weeklyOrders = await Order.aggregate([
      {
        $match: {
          adminId:   adminObjId,
          createdAt: { $gte: sevenDaysAgo },
          status:    'completed',
        },
      },
      {
        $group: {
          _id: { $dayOfWeek: '$createdAt' },
          // sales = customer buys (buy order type)
          sales: {
            $sum: {
              $cond: [
                { $eq: ['$orderType', 'buy'] },
                { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                0,
              ],
            },
          },
          // buys = customer sells (sell order type)
          buys: {
            $sum: {
              $cond: [
                { $eq: ['$orderType', 'sell'] },
                { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                0,
              ],
            },
          },
          salesCount: { $sum: { $cond: [{ $eq: ['$orderType', 'buy']  }, 1, 0] } },
          buysCount:  { $sum: { $cond: [{ $eq: ['$orderType', 'sell'] }, 1, 0] } },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { '_id': 1 } },
    ]);
 
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weeklyData = [];
    for (let i = 1; i <= 7; i++) {
      const found = weeklyOrders.find(w => w._id === i);
      weeklyData.push({
        day:        DAY_NAMES[i - 1],
        sales:      found?.sales      || 0,
        buys:       found?.buys       || 0,
        salesCount: found?.salesCount || 0,
        buysCount:  found?.buysCount  || 0,
        totalOrders:found?.orderCount || 0,
      });
    }
 
    // ── Daily sales vs buys (last 30 days, completed only) ───────────────────
    const dailyOrders = await Order.aggregate([
      {
        $match: {
          adminId:   adminObjId,
          createdAt: { $gte: thirtyDaysAgo },
          status:    'completed',
        },
      },
      {
        $group: {
          _id: {
            year:  { $year:        '$createdAt' },
            month: { $month:       '$createdAt' },
            day:   { $dayOfMonth:  '$createdAt' },
            date:  { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          },
          sales: {
            $sum: {
              $cond: [
                { $eq: ['$orderType', 'buy'] },
                { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                0,
              ],
            },
          },
          buys: {
            $sum: {
              $cond: [
                { $eq: ['$orderType', 'sell'] },
                { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                0,
              ],
            },
          },
          salesCount: { $sum: { $cond: [{ $eq: ['$orderType', 'buy']  }, 1, 0] } },
          buysCount:  { $sum: { $cond: [{ $eq: ['$orderType', 'sell'] }, 1, 0] } },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1 } },
    ]);
 
    const dailyData = dailyOrders.map(d => ({
      date:        d._id.date,
      sales:       d.sales,
      buys:        d.buys,
      salesCount:  d.salesCount,
      buysCount:   d.buysCount,
      totalOrders: d.orderCount,
    }));
 
    // ── Response ───────────────────────────────────────────────────────────────
    res.status(200).json({
      success: true,
 
      shopInfo: {
        shopName: admin.shopName,
      },
 
      customers: {
        total:   totalCustomers,
        trusted: trustedCustomers,
        flagged: flaggedCustomers,
        pending: 0,
      },
 
orders: {
  total:     totalOrders,
  pending:   pendingOrders,
  approved:  approvedOrders,
  completed: completedOrders,
  rejected:  rejectedOrders,
  cancelled: cancelledOrders,

  daily: {
    completed: dailyCompleted,
    pending:   dailyPending,
    approved:  dailyApproved,
    rejected:  dailyRejected,
    cancelled: dailyCancelled,
    total:     dailyCompleted + dailyPending + dailyApproved + dailyRejected + dailyCancelled,
  },
  weekly: {
    completed: weeklyCompleted,
    pending:   weeklyPending,
    approved:  weeklyApproved,
    rejected:  weeklyRejected,
    cancelled: weeklyCancelled,
    total:     weeklyCompleted + weeklyPending + weeklyApproved + weeklyRejected + weeklyCancelled,
  },
  monthly: {
    completed: monthlyCompleted,
    pending:   monthlyPending,
    approved:  monthlyApproved,
    rejected:  monthlyRejected,
    cancelled: monthlyCancelled,
    total:     monthlyCompleted + monthlyPending + monthlyApproved + monthlyRejected + monthlyCancelled,
  },
},
 
                revenue: {
        // All-time (from actual order aggregation - includes BOTH sell + buy)
        totalSales:     totalRevenueAllTime,        // Combined total
        totalPurchases: allTimeRev.totalPurchases,  // Buy revenue only
        sellRevenue:    allTimeRev.totalSales,      // Sell revenue only (ADD THIS)
        buyRevenue:     allTimeRev.totalPurchases,  // Buy revenue only (ADD THIS)
        salesCount:     allTimeRev.salesCount,
        purchasesCount: allTimeRev.purchasesCount,
 
        // Daily breakdown
        daily: {
          total:       dailyRevAgg.total,
          count:       dailyRevAgg.count,
          sellRevenue: dailyRevAgg.sellRev,
          buyRevenue:  dailyRevAgg.buyRev,
        },
        // Weekly breakdown
        weekly: {
          total:       weeklyRevAgg.total,
          count:       weeklyRevAgg.count,
          sellRevenue: weeklyRevAgg.sellRev,
          buyRevenue:  weeklyRevAgg.buyRev,
        },
        // Monthly breakdown
        monthly: {
          total:       monthlyRevAgg.total,
          count:       monthlyRevAgg.count,
          sellRevenue: monthlyRevAgg.sellRev,
          buyRevenue:  monthlyRevAgg.buyRev,
        },
      },
 
      recentOrders,
      monthlyTrend,
      weeklyData,
      dailyData,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
 


// ── ADMIN NOTIFICATIONS ───────────────────────────────────
export const getNotifications = async (req, res) => {
  try {
    const [notifications, unreadCount, totalCount] = await Promise.all([
      Notification.find({ userId: req.user.id, userModel: 'Admin' }).sort({ createdAt: -1 }).limit(50),
      Notification.countDocuments({ userId: req.user.id, userModel: 'Admin', isRead: false }),
      Notification.countDocuments({ userId: req.user.id, userModel: 'Admin' }), // ← ADD THIS
    ]);
    res.status(200).json({ success: true, unreadCount, totalCount, notifications });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user.id }, { isRead: true });
    res.status(200).json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user.id, userModel: 'Admin', isRead: false },  // ← Changed to Admin
      { isRead: true }
    );
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};



export const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user.id,
      userModel: 'Admin'  // ← Admin-specific
    });
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found.' });
    }
    await notification.deleteOne();
    res.status(200).json({ success: true, message: 'Notification deleted.' });
  } catch (error) {
    console.error('deleteNotification error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── WHATSAPP LINK GENERATOR ───────────────────────────────
export const getWhatsAppLink = async (req, res) => {
  try {
    const { customerId, templateType } = req.body;
    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    let message = '';
    if (templateType === 'general') {
      message = `Hello ${customer.name}, this is ${req.user.shopName}. How can we assist you?`;
    } else if (templateType === 'priceUpdate') {
      const admin = await Admin.findById(req.user.id);
      const [goldUSD, dollarPKR] = await Promise.all([fetchGoldPriceUSD(), fetchDollarRatePKR()]);
      const base = calculatePricePerTola(goldUSD, dollarPKR);
      message = `Dear ${customer.name}, today's gold price at ${admin.shopName}:\n24K: PKR ${applyPriceDifference(base, admin.diff_24k).toLocaleString()}/tola\n23.85K: PKR ${applyPriceDifference(Math.round(base * (23.85 / 24) * 100) / 100, admin.diff_2385k).toLocaleString()}/tola`;
    }

    res.status(200).json({
      success: true,
      whatsappLink: generateWhatsAppLink(customer.whatsappNumber || customer.phoneNumber, message),
      phone: formatWhatsAppNumber(customer.whatsappNumber || customer.phoneNumber),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── GET SHOP REGISTRATIONS ───────────────────────────────
export const getShopRegistrations = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;

    const query = { shopId: adminId };
    if (status) query.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [registrations, total] = await Promise.all([
      ShopRegistration.find(query)
  .populate('customerId', 'name email phoneNumber whatsappNumber address city shopRelations shopCustomerNumbers')
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(Number(limit)),
      ShopRegistration.countDocuments(query),
    ]);

    // Get counts by status
    const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
      ShopRegistration.countDocuments({ shopId: adminId, status: 'pending' }),
      ShopRegistration.countDocuments({ shopId: adminId, status: 'approved' }),
      ShopRegistration.countDocuments({ shopId: adminId, status: 'rejected' }),
    ]);

   const enrichedRegistrations = registrations.map(reg => {
  const regObj = reg.toObject();
  const customer = regObj.customerId;
  if (customer && customer.shopRelations) {
    const rel = customer.shopRelations.find(
      r => r.adminId.toString() === adminId.toString()
    );
    regObj.isTrusted = rel?.isTrusted || false;
    regObj.isFlagged = rel?.isFlagged || false;
    regObj.flagReason = rel?.flagReason || null;
  } else {
    regObj.isTrusted = false;
    regObj.isFlagged = false;
    regObj.flagReason = null;
  }
  return regObj;
});

res.status(200).json({
  success: true,
  total,
  page: Number(page),
  pages: Math.ceil(total / Number(limit)),
  counts: {
    pending: pendingCount,
    approved: approvedCount,
    rejected: rejectedCount,
  },
  registrations: enrichedRegistrations,
});
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// ── APPROVE SHOP REGISTRATION ────────────────────────────
// ── APPROVE SHOP REGISTRATION ────────────────────────────
export const approveShopRegistration = async (req, res) => {
  try {
    const registration = await ShopRegistration.findOne({
      _id: req.params.id,
      shopId: req.user.id,
    });

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }

    if (registration.status !== 'pending') {
      return res.status(400).json({ message: `Registration is already ${registration.status}.` });
    }

    registration.status = 'approved';
    registration.approvedBy = req.user.id;
    registration.approvedAt = new Date();
    await registration.save();

    // Get shop admin and customer
    const admin = await Admin.findById(req.user.id);
    const customer = await Customer.findById(registration.customerId);
    
       if (customer) {
      // Only update shopRelations if the registrant is actually a Customer
      // (admins / super admins do not have shopRelations)
      if (customer.constructor.modelName === 'Customer') {
        const adminIdStr = req.user.id.toString();
        const otherRelations = customer.shopRelations.filter(
          r => r.adminId.toString() !== adminIdStr
        );
        customer.shopRelations = [
          ...otherRelations,
          {
            adminId: req.user.id,
            isTrusted: false,
            isFlagged: false,
          }
        ];

        // Assign sequential customer number only for Customers
        const existingCount = await ShopRegistration.countDocuments({
          shopId: req.user.id,
          status: 'approved',
        });
        const seq = existingCount;
        const shopSuffix = String(req.user.id).slice(-4).toUpperCase();
        const customerNumber = `SC-${shopSuffix}-${String(seq).padStart(4, '0')}`;

        const alreadyHasNumber = customer.shopCustomerNumbers?.some(
          n => n.adminId.toString() === req.user.id
        );

        if (!alreadyHasNumber) {
          customer.shopCustomerNumbers = customer.shopCustomerNumbers || [];
          customer.shopCustomerNumbers.push({
            adminId: req.user.id,
            number: customerNumber,
            seq: seq,
          });
        }
        await customer.save();
      }
      // If not a Customer (Admin/SuperAdmin), skip the above updates.
    }

    // ── SEND WHATSAPP MESSAGE FROM SHOP NUMBER ──
    let whatsappResult = null;
    if (customer && (customer.whatsappNumber || customer.phoneNumber)) {
      const customerPhone = customer.whatsappNumber || customer.phoneNumber;
      const shopName = admin?.shopName || 'the shop';
      const message = whatsAppTemplates.registrationApproved(customer.name, shopName);
      
      whatsappResult = await sendWhatsAppFromShop(
        customerPhone,
        message,
        admin?.whatsappNumber || admin?.phoneNumber
      );
    }

    // ── CREATE IN-APP NOTIFICATION ──
    await Notification.create({
      userId: registration.customerId,
      userModel: 'Customer',
      title: 'Registration Approved! 🎉',
      message: `Your registration with ${admin?.shopName || 'the shop'} has been approved. You can now place orders.`,
      type: 'customer_registration',
      data: { 
        registrationId: registration._id, 
        shopId: req.user.id,
        shopName: admin?.shopName 
      },
    });

    res.status(200).json({
      success: true,
      message: 'Registration approved. Customer can now place orders.',
      whatsappLink: whatsappResult?.link || null,
      whatsappSent: whatsappResult?.success || false,
      registration,
    });
  } catch (error) {
    console.error('approveShopRegistration error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// ── REJECT SHOP REGISTRATION ─────────────────────────────
export const rejectShopRegistration = async (req, res) => {
  try {
    const { reason } = req.body;
    const registration = await ShopRegistration.findOne({
      _id: req.params.id,
      shopId: req.user.id,
    });

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }

    if (registration.status !== 'pending') {
      return res.status(400).json({ message: `Registration is already ${registration.status}.` });
    }

    registration.status = 'rejected';
    registration.rejectedAt = new Date();
    registration.rejectionReason = reason || 'Rejected by shop';
    await registration.save();

    // Get shop admin and customer
    const admin = await Admin.findById(req.user.id);
    const customer = await Customer.findById(registration.customerId);

    // ── SEND WHATSAPP MESSAGE FROM SHOP NUMBER ──
    let whatsappResult = null;
    if (customer && (customer.whatsappNumber || customer.phoneNumber)) {
      const customerPhone = customer.whatsappNumber || customer.phoneNumber;
      const shopName = admin?.shopName || 'the shop';
      const message = whatsAppTemplates.registrationRejected(customer.name, shopName, reason);
      
      whatsappResult = await sendWhatsAppFromShop(
        customerPhone,
        message,
        admin?.whatsappNumber || admin?.phoneNumber
      );
    }

    // ── CREATE IN-APP NOTIFICATION ──
    await Notification.create({
      userId: registration.customerId,
      userModel: 'Customer',
      title: 'Registration Declined',
      message: `Your registration request with ${admin?.shopName || 'the shop'} was not approved. Reason: ${reason || 'Please contact the shop for details.'}`,
      type: 'customer_registration',
      data: { registrationId: registration._id, reason },
    });

    res.status(200).json({
      success: true,
      message: 'Registration rejected.',
      whatsappLink: whatsappResult?.link || null,
      whatsappSent: whatsappResult?.success || false,
      registration,
    });
  } catch (error) {
    console.error('rejectShopRegistration error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const unflagCustomer = async (req, res) => {
  try {
    const adminId = req.user.id;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const admin = await Admin.findById(adminId);
    const adminIdStr = adminId.toString();
    
    const otherRelations = customer.shopRelations.filter(
      r => r.adminId.toString() !== adminIdStr
    );
    
    const shopRelations = customer.shopRelations.filter(
      r => r.adminId.toString() === adminIdStr
    );
    
    if (shopRelations.length > 0) {
      const lastRel = shopRelations[shopRelations.length - 1];
      lastRel.isFlagged = false;
      lastRel.flagReason = null;
      lastRel.flaggedBy = null;
      
      customer.shopRelations = [...otherRelations, lastRel];
    }
    
    await customer.save();

    // ── SEND WHATSAPP MESSAGE FROM SHOP NUMBER ──
    let whatsappResult = null;
    if (customer.whatsappNumber || customer.phoneNumber) {
      const customerPhone = customer.whatsappNumber || customer.phoneNumber;
      const shopName = admin?.shopName || 'the shop';
      const message = whatsAppTemplates.flagRemoved(customer.name, shopName);
      
      whatsappResult = await sendWhatsAppFromShop(
        customerPhone,
        message,
        admin?.whatsappNumber || admin?.phoneNumber
      );
    }

    // ── CREATE IN-APP NOTIFICATION ──
    await Notification.create({
      userId: customer._id,
      userModel: 'Customer',
      title: 'Flag Removed ✅',
      message: `${admin?.shopName || 'The shop'} has removed the flag from your account. You can now place orders again.`,
      type: 'customer_unflagged',
      data: { adminId: req.user.id, shopName: admin?.shopName },
    });

    res.status(200).json({ 
      success: true, 
      message: 'Flag removed from customer.',
      whatsappLink: whatsappResult?.link || null,
      whatsappSent: whatsappResult?.success || false,
    });
  } catch (error) {
    console.error('unflagCustomer error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// ─── ADMIN LIVE PRICE STREAM (SSE) ───────────────────────────────────
export const getAdminLivePriceStream = async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(':ok\n\n');

  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setTimeout(0);
  }

  const adminId = req.user.id;
  const admin = await Admin.findById(adminId).lean();

  const sendPrices = async () => {
    try {
      const [livePrices, currencies] = await Promise.all([
        fetchAllPrices(),
        Currency.find(),
      ]);

      const currencyMap = {};
      currencies.forEach(c => { currencyMap[c.currency] = c; });

      const basePKR_24k = livePrices.gold.pricePerTolaPKR;
      const base2385 = Math.round((basePKR_24k * (23.85 / 24)) * 100) / 100;
      const basePKR_silver = livePrices.silver.pricePerTolaPKR;

      // Build currency entries with admin's own diffs
      const currencyEntries = Object.fromEntries(
        Object.entries(livePrices.currencies).map(([code, data]) => {
          const liveRate = data.rate;
          const adminDiff = Number(admin.currencyDiff?.[code] ?? 0) || 0;
          const adminBuyDiff = Number(admin.currencyBuyDiff?.[code] ?? 0) || 0;
          const adjustedRate = liveRate + adminDiff;
          const buyRate = liveRate + adminBuyDiff;

          return [code, {
            ...data,
            liveRate,
            adjustedRate,
            buyRate,
            adminDiff,
            adminBuyDiff,
          }];
        })
      );

      const payload = {
        gold: {
          priceUSD: livePrices.gold.priceUSD,
          basePricePerTola_24k: basePKR_24k,
          basePricePerTola_2385k: base2385,
          myPrice_24k: applyPriceDifference(basePKR_24k, admin.diff_24k ?? 0),
          myPrice_2385k: applyPriceDifference(base2385, admin.diff_2385k ?? 0),
          diff_24k: admin.diff_24k ?? 0,
          diff_2385k: admin.diff_2385k ?? 0,
          myBuyPrice_24k: applyPriceDifference(basePKR_24k, admin.buy_diff_24k ?? 0),
          myBuyPrice_2385k: applyPriceDifference(base2385, admin.buy_diff_2385k ?? 0),
          buy_diff_24k: admin.buy_diff_24k ?? 0,
          buy_diff_2385k: admin.buy_diff_2385k ?? 0,
        },
        silver: {
          priceUSD: livePrices.silver.priceUSD,
          basePricePerTola: basePKR_silver,
          myPrice: applyPriceDifference(basePKR_silver, admin.diff_silver ?? 0),
          diff_silver: admin.diff_silver ?? 0,
          myBuyPrice: applyPriceDifference(basePKR_silver, admin.buy_diff_silver ?? 0),
          buy_diff_silver: admin.buy_diff_silver ?? 0,
        },
        currencies: currencyEntries,
        timestamp: livePrices.timestamp,
      };

      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      console.error('Admin SSE error:', err.message);
      res.write(`data: ${JSON.stringify({ error: 'Price feed temporarily unavailable' })}\n\n`);
    }
  };

  await sendPrices();
  const interval = setInterval(sendPrices, 30_000);
  const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); }, 20_000);

  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
};