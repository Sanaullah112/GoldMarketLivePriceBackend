// ============================================================
// controllers/customerController.js
// ============================================================
import Customer        from '../models/Customer.js';
import Admin           from '../models/Admin.js';
import SuperAdmin      from '../models/SuperAdmin.js';
import Order           from '../models/Order.js';
import Notification    from '../models/Notification.js';
import Currency        from '../models/Currency.js';
import Picture         from '../models/Picture.js';
import ShopRegistration from '../models/ShopRegistration.js';
import {
  fetchAllPrices,
  applyPriceDifference,
  convertQuantity,
  calculateTotalPrice,
} from '../utils/goldPriceCalculator.js';
import { generateWhatsAppLink } from '../utils/whatsapp.js';
import { generateReceipt }      from '../utils/receiptGenerator.js';

// ── Constants ─────────────────────────────────────────────
const TOLA_GRAMS = 11.664; // grams per tola

/**
 * Decompose a gram value into whole Tola, Masha, Ratti and remaining grams.
 * 1 Tola = 12 Masha = 96 Ratti = 11.664 g
 */
function decomposeGrams(grams) {
  if (!grams || grams <= 0) return { tola: 0, masha: 0, ratti: 0 };
  const totalRatti = grams / (TOLA_GRAMS / 96);
  const tola       = Math.floor(totalRatti / 96);
  const rem        = totalRatti - tola * 96;
  const masha      = Math.floor(rem / 8);
  const ratti      = Math.floor(rem - masha * 8);
  return { tola, masha, ratti };
}

/**
 * Build a human-readable quantity string, e.g. "2T 3M 1Ra (23.328 g)"
 */
function buildQuantityDisplay(tola, masha, ratti, grams) {
  const parts = [];
  if (tola  > 0) parts.push(`${tola}T`);
  if (masha > 0) parts.push(`${masha}M`);
  if (ratti > 0) parts.push(`${ratti}Ra`);
  if (!parts.length) parts.push('0T');
  return `${parts.join(' ')} (${parseFloat(grams.toFixed(4))} g)`;
}

// ── REGISTRATION ──────────────────────────────────────────
export const register = async (req, res) => {
  try {
    const { name, password, phoneNumber, whatsappNumber, address, city, email } = req.body;

    const phone = (phoneNumber || '').toString().trim();
    const emailLower = (email || '').toString().trim().toLowerCase() || null;
    if (!phone) return res.status(400).json({ message: 'Phone number is required.' });

    let existingCustomer = null, existingAdmin = null, existingSuperAdmin = null;
    if (emailLower) {
      [existingCustomer, existingAdmin, existingSuperAdmin] = await Promise.all([
        Customer.findOne({ $or: [{ phoneNumber: phone }, { email: emailLower }] }),
        Admin.findOne({ $or: [{ phoneNumber: phone }, { email: emailLower }] }),
        SuperAdmin.findOne({ $or: [{ phoneNumber: phone }, { email: emailLower }] }),
      ]);
    } else {
      [existingCustomer, existingAdmin, existingSuperAdmin] = await Promise.all([
        Customer.findOne({ phoneNumber: phone }),
        Admin.findOne({ phoneNumber: phone }),
        SuperAdmin.findOne({ phoneNumber: phone }),
      ]);
    }
    if (existingCustomer || existingAdmin || existingSuperAdmin) {
      return res.status(400).json({ message: 'An account with this phone number or email already exists.' });
    }

    const customer = await Customer.create({
      name,
      password,
      phoneNumber: phone,
      email: emailLower,
      whatsappNumber: whatsappNumber || phone,
      address: address || null,
      city:    city    || null,
    });

    try { 
      const admins = await Admin.find({ isActive: true });
      const notifs = admins.map((a) => ({
        userId: a._id, userModel: 'Admin',
        title:   'New Customer Registered',
        message: `${name} (${phone}) from ${city || 'Unknown city'} has registered.`,
        type: 'customer_registration',
        data: { customerId: customer._id, customerName: name, phone: phone, city, address },
      }));
      if (notifs.length) await Notification.insertMany(notifs);

      const superAdmins = await SuperAdmin.find({ isActive: true });
      const saNotifs = superAdmins.map((sa) => ({
        userId: sa._id, userModel: 'SuperAdmin',
        title:   'New Customer Registered',
        message: `${name} registered from ${city || 'Unknown city'}. Phone: ${phone}`,
        type: 'customer_registration',
        data: { customerId: customer._id },
      }));
      if (saNotifs.length) await Notification.insertMany(saNotifs);
    } catch (notifError) {
      console.error('Failed to send registration notifications:', notifError);
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful! You can now log in.',
      customer: { id: customer._id, name: customer.name, phoneNumber: customer.phoneNumber },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── GET ALL SHOPS ─────────────────────────────────────────
export const getAllShops = async (req, res) => {
  try {
    const [admins, superAdmins, livePrices, currencies] = await Promise.all([
      Admin.find({ isActive: true }).select('-password -diff_silver -currencyDiff -createdBy'),
      SuperAdmin.find({ isActive: true }).select(
        'shopName phoneNumber whatsappNumber address city profilePicture diff_24k diff_2385k diff_silver buy_diff_24k buy_diff_2385k buy_diff_silver'
      ),
      fetchAllPrices(),
      Currency.find(),
    ]);

    const currencyMap = {};
    currencies.forEach((c) => { currencyMap[c.currency] = c; });

    const basePKR_24k = livePrices.gold.pricePerTolaPKR;
    const base2385    = Math.round((basePKR_24k * (23.85 / 24)) * 100) / 100;
    const baseSilver  = livePrices.silver.pricePerTolaPKR;

    const adminShops = admins.map((a) => ({
      id:             a._id,
      shopName:       a.shopName,
      shopLogo:       a.shopLogo,
      phoneNumber:    a.phoneNumber,
      whatsappNumber: a.whatsappNumber || a.phoneNumber,
      address:        a.address,
      city:           a.city,
      shopType:       'admin',
      prices: {
        sell_24k:    applyPriceDifference(basePKR_24k, a.diff_24k        ?? 0),
        sell_2385k:  applyPriceDifference(base2385,    a.diff_2385k      ?? 0),
        buy_24k:     applyPriceDifference(basePKR_24k, a.buy_diff_24k    ?? 0),
        buy_2385k:   applyPriceDifference(base2385,    a.buy_diff_2385k  ?? 0),
        sell_silver: applyPriceDifference(baseSilver,  a.diff_silver     ?? 0),
        buy_silver:  applyPriceDifference(baseSilver,  a.buy_diff_silver ?? 0),
      },
      whatsappLink: generateWhatsAppLink(
        a.whatsappNumber || a.phoneNumber || '',
        `Hello, I'm interested in buying/selling gold.`
      ),
    }));

    const saShops = superAdmins.map((sa) => ({
      id:             sa._id,
      shopName:       sa.shopName || 'GoldChain HQ',
      shopLogo:       sa.profilePicture || null,
      phoneNumber:    sa.phoneNumber,
      whatsappNumber: sa.whatsappNumber || sa.phoneNumber,
      address:        sa.address,
      city:           sa.city,
      shopType:       'super_admin',
      prices: {
        sell_24k:    applyPriceDifference(basePKR_24k, sa.diff_24k        ?? 0),
        sell_2385k:  applyPriceDifference(base2385,    sa.diff_2385k      ?? 0),
        buy_24k:     applyPriceDifference(basePKR_24k, sa.buy_diff_24k    ?? 0),
        buy_2385k:   applyPriceDifference(base2385,    sa.buy_diff_2385k  ?? 0),
        sell_silver: applyPriceDifference(baseSilver,  sa.diff_silver     ?? 0),
        buy_silver:  applyPriceDifference(baseSilver,  sa.buy_diff_silver ?? 0),
      },
      whatsappLink: generateWhatsAppLink(
        sa.whatsappNumber || sa.phoneNumber || '',
        `Hello, I'm interested in buying/selling gold.`
      ),
    }));

    const shops = [...saShops, ...adminShops];

    res.status(200).json({
      success: true,
      marketPrices: {
        gold_24k_per_tola_PKR:   basePKR_24k,
        gold_2385k_per_tola_PKR: base2385,
        gold_per_oz_USD:         livePrices.gold.priceUSD,
        silver_per_tola_PKR:     livePrices.silver.pricePerTolaPKR,
        currencies: Object.fromEntries(
          Object.entries(livePrices.currencies).map(([code, data]) => {
            const dbC = currencyMap[code];
            return [code, { ...data, adjustedRate: data.rate + (dbC?.difference || 0), difference: dbC?.difference || 0 }];
          })
        ),
        lastUpdated: livePrices.timestamp,
      },
      shops,
      totalShops: shops.length,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── GET SHOP BY ID ────────────────────────────────────────
export const getShopById = async (req, res) => {
  try {
    const shopId = req.params.id;

    let shopDoc  = null;
    let shopType = 'admin';

    shopDoc = await Admin.findOne({ _id: shopId, isActive: true }).select('-password -diff_silver -currencyDiff -createdBy');
    if (!shopDoc) {
      shopDoc  = await SuperAdmin.findOne({ _id: shopId, isActive: true }).select('shopName phoneNumber address city diff_24k diff_2385k profilePicture');
      shopType = shopDoc ? 'super_admin' : null;
    }

    if (!shopDoc) return res.status(404).json({ message: 'Shop not found' });

    const [livePrices, pictures] = await Promise.all([
      fetchAllPrices(),
      Picture.find({
        uploadedBy:    shopDoc._id,
        uploaderModel: shopType === 'admin' ? 'Admin' : 'SuperAdmin',
        showOnHomePage: true,
        isActive:      true,
      }).sort({ createdAt: -1 }).limit(12),
    ]);

    const basePKR_24k = livePrices.gold.pricePerTolaPKR;
    const base2385    = Math.round((basePKR_24k * (23.85 / 24)) * 100) / 100;

    res.status(200).json({
      success: true,
      shop: {
        id:          shopDoc._id,
        shopName:    shopDoc.shopName || 'GoldChain HQ',
        shopLogo:    shopDoc.shopLogo || shopDoc.profilePicture || null,
        phoneNumber: shopDoc.phoneNumber,
        address:     shopDoc.address,
        city:        shopDoc.city,
        shopType,
        prices: {
          gold_24k:   { basePrice: basePKR_24k, finalPrice: applyPriceDifference(basePKR_24k, shopDoc.diff_24k   ?? 0), diff: shopDoc.diff_24k   ?? 0 },
          gold_2385k: { basePrice: base2385,    finalPrice: applyPriceDifference(base2385,    shopDoc.diff_2385k ?? 0), diff: shopDoc.diff_2385k ?? 0 },
        },
        pictures,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── PLACE ORDER ───────────────────────────────────────────
export const placeOrder = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'You must be logged in to place an order.' });
    }

    const {
      adminId,
      orderType,
      metalType,
      carat,
      quantity,
      unit,
      paymentMethod,
      notes,
      quantityInGrams,
      quantityInTola,
      quantityInMasha,
      quantityInRatti,
      quantityDisplay,
      inputMode,
    } = req.body;

    // ── Resolve user model and name ──────────────────────────────────────────
    let userModel = 'Customer';
    let userName  = req.user.name || req.user.shopName || 'User';

    if (req.user.role === 'customer') {
      const customer = await Customer.findById(req.user.id);
      if (!customer) return res.status(401).json({ message: 'Customer account not found.' });
      const matchingRels = (customer.shopRelations || []).filter(r => r.adminId.toString() === adminId);
      const shopRelation = matchingRels[matchingRels.length - 1];
      if (shopRelation?.isFlagged) {
        return res.status(403).json({
          message: 'You have been flagged by this shop and cannot place orders.',
          flagged: true,
        });
      }
      userName = customer.name;
    } else if (req.user.role === 'admin') {
      userModel = 'Admin';
      const admin = await Admin.findById(req.user.id);
      if (admin) userName = admin.shopName || admin.name;
    } else if (req.user.role === 'super_admin') {
      userModel = 'SuperAdmin';
      const sa = await SuperAdmin.findById(req.user.id);
      if (sa) userName = sa.shopName || sa.name;
    }

    if (req.user.id === adminId) {
      return res.status(400).json({ message: 'You cannot buy from or sell to your own shop.' });
    }

    // ── Non‑customer users must be registered with the shop ──────────────────
    if (req.user.role !== 'customer') {
      const reg = await ShopRegistration.findOne({
        customerId: req.user.id,
        shopId: adminId,
        status: 'approved',
      });
      if (!reg) {
        return res.status(403).json({
          message: 'You must be registered and approved by this shop before placing an order.',
        });
      }
    }

    // ── Resolve shop (Admin or SuperAdmin) ───────────────────────────────────
    let shopDoc = null;
    let shopType = 'admin';
    shopDoc = await Admin.findOne({ _id: adminId, isActive: true });
    if (!shopDoc) {
      shopDoc = await SuperAdmin.findOne({ _id: adminId, isActive: true });
      shopType = shopDoc ? 'super_admin' : null;
    }
    if (!shopDoc) return res.status(404).json({ message: 'Shop not found or inactive.' });

    const livePrices = await fetchAllPrices();
    const shopName = shopDoc.shopName || 'Shop';
    const orderStatus = 'pending';
    const notifTarget = shopType === 'admin' ? 'Admin' : 'SuperAdmin';

    // ─────────────────────────────── CURRENCY ORDER ───────────────────────────
   if (metalType === 'currency') {
  const currencyCode = unit;
  const currencyData = livePrices.currencies?.[currencyCode];
  if (!currencyData) return res.status(400).json({ message: `Currency ${currencyCode} not available.` });

  // ❌ REMOVE these lines:
  // const currencyDoc = await Currency.findOne({ currency: currencyCode });
  // const saSellDiff   = currencyDoc?.difference     ?? 0;
  // const saBuyDiff    = currencyDoc?.buy_difference ?? 0;

  // ✅ ONLY use the shop's own diffs (stored on the shop document itself)
  const shopSellDiff = shopDoc.currencyDiff?.[currencyCode]    ?? 0;
  const shopBuyDiff  = shopDoc.currencyBuyDiff?.[currencyCode] ?? 0;

  const liveRate = currencyData.rate;
  
  // ✅ REMOVE + saSellDiff and + saBuyDiff
  const finalRate = orderType === 'buy'
    ? liveRate + shopSellDiff   // was: liveRate + saSellDiff + shopSellDiff
    : liveRate + shopBuyDiff;    // was: liveRate + saBuyDiff + shopBuyDiff

  const totalAmount = Number(quantity) * finalRate;

      const order = await Order.create({
        customerId: req.user.id,
        adminId,
        adminModel: shopType === 'super_admin' ? 'SuperAdmin' : 'Admin',
        orderType,
        metalType: 'currency',
        carat: '24k',
        quantity: Number(quantity),
        unit: currencyCode,
        quantityInTola: 0,
        quantityInGram: 0,
        quantityInMasha: 0,
        quantityInRatti: 0,
        quantityDisplay: `${quantity} ${currencyCode}`,
        inputMode: 'simple',
        marketPriceUSD: livePrices.gold.priceUSD,
        dollarRatePKR: liveRate,
        basePricePerTolaPKR: liveRate,
        adminDiffPKR: finalRate - liveRate,
        finalPricePerTolaPKR: finalRate,
        totalAmount,
        paymentMethod: paymentMethod || 'cash',
        notes: notes || null,
        status: orderStatus,
      });

      await Promise.all([
        Notification.create({
          userId: adminId, userModel: notifTarget,
          title: 'New Currency Order',
          message: `${userName} wants to ${orderType} ${quantity} ${currencyCode}. Total: PKR ${totalAmount.toLocaleString()}`,
          type: 'order',
          data: { orderId: order._id, customerId: req.user.id, totalAmount },
        }),
        Notification.create({
          userId: req.user.id, userModel,
          title: 'Request Sent!',
          message: `Your ${orderType} request for ${quantity} ${currencyCode} sent to ${shopName}.`,
          type: 'order',
          data: { orderId: order._id, totalAmount },
        }),
      ]);

      return res.status(201).json({
        success: true,
        message: `Your ${orderType} request has been sent to ${shopName}.`,
        order: {
          id: order._id, orderType, metalType: 'currency', carat: '24k',
          quantity, unit: currencyCode, totalAmount,
          status: order.status, shopName, createdAt: order.createdAt,
        },
      });
    }

    // ─────────────────────────────── GOLD / SILVER ORDER ──────────────────────
    const basePKR_24k = livePrices.gold.pricePerTolaPKR;
    const base2385 = basePKR_24k * (23.85 / 24);
    const baseSilver = livePrices.silver.pricePerTolaPKR;

    let basePricePerTola, adminDiff;
    if (metalType === 'gold') {
      if (carat === '24k') {
        basePricePerTola = basePKR_24k;
        adminDiff = orderType === 'buy' ? (shopDoc.diff_24k ?? 0) : (shopDoc.buy_diff_24k ?? 0);
      } else {
        basePricePerTola = base2385;
        adminDiff = orderType === 'buy' ? (shopDoc.diff_2385k ?? 0) : (shopDoc.buy_diff_2385k ?? 0);
      }
    } else {
      basePricePerTola = baseSilver;
      adminDiff = orderType === 'buy' ? (shopDoc.diff_silver ?? 0) : (shopDoc.buy_diff_silver ?? 0);
    }

    const finalPricePerTola = basePricePerTola + adminDiff;   // no rounding

    // Normalise quantity – use quantityInGrams as canonical source
    const grams = Number(quantityInGrams) || 0;
    const tolaFromGrams = grams / TOLA_GRAMS;

    const breakdown = (grams) => {
      const totalRatti = grams / (TOLA_GRAMS / 96);
      const tola = Math.floor(totalRatti / 96);
      const rem = totalRatti - tola * 96;
      const masha = Math.floor(rem / 8);
      const ratti = rem - masha * 8;
      return { tola, masha, ratti };
    };
    const bd = breakdown(grams);
    const finalTola  = (quantityInTola  !== undefined && !isNaN(quantityInTola))  ? Number(quantityInTola)  : bd.tola;
    const finalMasha = (quantityInMasha !== undefined && !isNaN(quantityInMasha)) ? Number(quantityInMasha) : bd.masha;
    const finalRatti = (quantityInRatti !== undefined && !isNaN(quantityInRatti)) ? Number(quantityInRatti) : bd.ratti;

    const finalDisplay = quantityDisplay || (() => {
      const parts = [];
      if (finalTola > 0) parts.push(`${finalTola}T`);
      if (finalMasha > 0) parts.push(`${finalMasha}M`);
      if (finalRatti > 0) parts.push(`${finalRatti}Ra`);
      if (!parts.length) parts.push('0T');
      return `${parts.join(' ')} (${grams.toFixed(4)} g)`;
    })();

    const totalAmount = tolaFromGrams * finalPricePerTola;   // no rounding

    const order = await Order.create({
      customerId: req.user.id,
      adminId,
      orderType,
      metalType,
      carat: metalType === 'gold' ? carat : '24k',
      quantity: Number(quantity),
      unit: unit || 'gram',
      quantityInTola: parseFloat(tolaFromGrams.toFixed(6)),
      quantityInGram: parseFloat(grams.toFixed(6)),
      quantityInMasha: finalMasha,
      quantityInRatti: finalRatti,
      quantityDisplay: finalDisplay,
      inputMode: inputMode || 'simple',
      marketPriceUSD: livePrices.gold.priceUSD,
      dollarRatePKR: livePrices.currencies.USD.rate,
      basePricePerTolaPKR: basePricePerTola,
      adminDiffPKR: adminDiff,
      finalPricePerTolaPKR: finalPricePerTola,
      totalAmount,
      paymentMethod: paymentMethod || 'cash',
      notes: notes || null,
      status: orderStatus,
    });

    await Promise.all([
      Notification.create({
        userId: adminId, userModel: notifTarget,
        title: 'New Order Request',
        message: `${userName} wants to ${orderType} ${finalDisplay} of ${metalType} (${carat}). Total: PKR ${totalAmount.toLocaleString()}`,
        type: 'order',
        data: { orderId: order._id, customerId: req.user.id, totalAmount },
      }),
      Notification.create({
        userId: req.user.id, userModel,
        title: 'Request Sent!',
        message: `Your ${orderType} request for ${finalDisplay} of ${metalType} sent to ${shopName}.`,
        type: 'order',
        data: { orderId: order._id, totalAmount },
      }),
    ]);

    res.status(201).json({
      success: true,
      message: `Your ${orderType} request has been sent to ${shopName}.`,
      order: {
        id: order._id, orderType, metalType, carat,
        quantity, unit,
        quantityInTola: order.quantityInTola,
        quantityInGram: order.quantityInGram,
        quantityInMasha: order.quantityInMasha,
        quantityInRatti: order.quantityInRatti,
        quantityDisplay: order.quantityDisplay,
        inputMode: order.inputMode,
        pricePerTola: finalPricePerTola,
        totalAmount,
        status: order.status,
        shopName,
        createdAt: order.createdAt,
      },
    });
  } catch (error) {
    console.error('placeOrder error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getMyOrders = async (req, res) => {
  try {
    const { status, orderType, page = 1, limit = 20 } = req.query;
    const query = { customerId: req.user.id };
    if (status)    query.status    = status;
    if (orderType) query.orderType = orderType;

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('customerId', 'name email phoneNumber whatsappNumber shopRelations')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Order.countDocuments(query),
    ]);

    // Collect ALL unique adminIds — search both collections, don't trust adminModel
    const allAdminIds = [...new Set(orders.map(o => String(o.adminId)))];

    const [adminDocs, superAdminDocs] = await Promise.all([
      allAdminIds.length
        ? Admin.find({ _id: { $in: allAdminIds } })
            .select('shopName name phoneNumber address city')
            .lean()
        : [],
      allAdminIds.length
        ? SuperAdmin.find({ _id: { $in: allAdminIds } })
            .select('shopName name phoneNumber address city')
            .lean()
        : [],
    ]);

    // Merge — SuperAdmin entry overwrites Admin entry if same ID (won't happen in practice)
    const shopMap = {};
    adminDocs.forEach(d      => { shopMap[String(d._id)] = d; });
    superAdminDocs.forEach(d => { shopMap[String(d._id)] = d; });

    const enriched = orders.map(o => {
      const doc = shopMap[String(o.adminId)];
      o.adminId = doc
        ? {
            _id:         doc._id,
            shopName:    doc.shopName?.trim() || doc.name?.trim() || 'Shop',
            phoneNumber: doc.phoneNumber || null,
            address:     doc.address    || null,
            city:        doc.city       || null,
          }
        : { _id: String(o.adminId), shopName: 'Shop', phoneNumber: null };
      return o;
    });

    res.status(200).json({
      success: true,
      total,
      page:  Number(page),
      pages: Math.ceil(total / Number(limit)),
      orders: enriched,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user.id })
      .populate('adminId', 'shopName shopLogo phoneNumber address');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    let receipt = null;
    if (order.status === 'completed') {
      let shopDoc = await Admin.findById(order.adminId);
      if (!shopDoc) shopDoc = await SuperAdmin.findById(order.adminId);
      const customer = await Customer.findById(req.user.id);
      if (shopDoc && customer) receipt = generateReceipt(order, shopDoc, customer);
    }

    res.status(200).json({ success: true, order, receipt });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── PROFILE ───────────────────────────────────────────────
export const updateProfile = async (req, res) => {
  try {
    const { name, phoneNumber, whatsappNumber, address, city } = req.body;
    const customer = await Customer.findById(req.user.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    if (name           !== undefined) customer.name           = name.trim();
    if (phoneNumber    !== undefined) customer.phoneNumber    = phoneNumber.trim();
    if (whatsappNumber !== undefined) customer.whatsappNumber = whatsappNumber.trim();
    if (address        !== undefined) customer.address        = address.trim();
    if (city           !== undefined) customer.city           = city.trim();

    await customer.save();
    res.status(200).json({
      success: true,
      message: 'Profile updated',
      customer: {
        name:           customer.name,
        email:          customer.email,
        phoneNumber:    customer.phoneNumber,
        whatsappNumber: customer.whatsappNumber,
        address:        customer.address,
        city:           customer.city,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const customer = await Customer.findById(req.user.id)
      .select('-password')
      .populate('addedBy', 'shopName name');
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.status(200).json({ success: true, customer });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── NOTIFICATIONS ─────────────────────────────────────────
export const getNotifications = async (req, res) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ userId: req.user.id, userModel: 'Customer' }).sort({ createdAt: -1 }).limit(50),
      Notification.countDocuments({ userId: req.user.id, userModel: 'Customer', isRead: false }),
    ]);
    res.status(200).json({ success: true, unreadCount, notifications });
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
      { userId: req.user.id, userModel: 'Customer', isRead: false },
      { isRead: true }
    );
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// ── GET UNREAD COUNT ONLY (for navbar badge) ─────────────────────────
export const getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      userId: req.user.id,
      userModel: 'Customer',
      isRead: false
    });
    
    res.status(200).json({ 
      success: true, 
      unreadCount 
    });
  } catch (error) {
    console.error('getUnreadCount error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── DELETE SINGLE NOTIFICATION ──────────────────────────────────────
export const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user.id,
      userModel: 'Customer'
    });
    
    if (!notification) {
      return res.status(404).json({ 
        success: false, 
        message: 'Notification not found' 
      });
    }
    
    // Store if it was unread to update counts if needed
    const wasUnread = !notification.isRead;
    
    await notification.deleteOne();
    
    res.status(200).json({ 
      success: true, 
      message: 'Notification deleted successfully',
      wasUnread // Optional: frontend can use this to update count
    });
  } catch (error) {
    console.error('deleteNotification error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── DELETE ALL NOTIFICATIONS FOR CUSTOMER ───────────────────────────
export const deleteAllNotifications = async (req, res) => {
  try {
    const result = await Notification.deleteMany({
      userId: req.user.id,
      userModel: 'Customer'
    });
    
    res.status(200).json({ 
      success: true, 
      message: 'All notifications deleted successfully',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('deleteAllNotifications error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── DELETE SELECTED NOTIFICATIONS (Bulk) ────────────────────────────
export const deleteSelectedNotifications = async (req, res) => {
  try {
    const { notificationIds } = req.body;
    
    if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide an array of notification IDs' 
      });
    }
    
    const result = await Notification.deleteMany({
      _id: { $in: notificationIds },
      userId: req.user.id,
      userModel: 'Customer'
    });
    
    res.status(200).json({ 
      success: true, 
      message: `${result.deletedCount} notifications deleted successfully`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('deleteSelectedNotifications error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── WHATSAPP CONTACT ──────────────────────────────────────
export const getWhatsAppContact = async (req, res) => {
  try {
    let shopDoc = await Admin.findOne({ _id: req.params.id, isActive: true });
    if (!shopDoc) shopDoc = await SuperAdmin.findOne({ _id: req.params.id, isActive: true });
    if (!shopDoc) return res.status(404).json({ message: 'Shop not found' });

    const customer = await Customer.findById(req.user.id);
    const message  = `Hello, I am ${customer.name}. I would like to inquire about gold.`;
    const phone    = shopDoc.whatsappNumber || shopDoc.phoneNumber;

    res.status(200).json({
      success:      true,
      shopWhatsApp: phone,
      whatsappLink: generateWhatsAppLink(phone, message),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const registerWithShop = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { name, phoneNumber, whatsappNumber, address, city, policyAgreed } = req.body;

    if (!policyAgreed) {
      return res.status(400).json({ message: 'You must agree to the price policy.' });
    }

    // Resolve the shop (Admin or SuperAdmin)
    let shopType = 'admin';
    let shopDoc = await Admin.findOne({ _id: shopId, isActive: true });
    let shopModel = 'Admin';
    if (!shopDoc) {
      shopDoc = await SuperAdmin.findOne({ _id: shopId, isActive: true });
      shopModel = 'SuperAdmin';
    }
    if (!shopDoc) return res.status(404).json({ message: 'Shop not found or inactive.' });

    // Prevent self‑registration
    if (req.user.id === shopId) {
      return res.status(400).json({ message: 'You cannot register with your own shop.' });
    }

    // Check for existing registration (any role)
    const existingReg = await ShopRegistration.findOne({
      customerId: req.user.id,
      shopId,
    });
    if (existingReg) {
      if (existingReg.status === 'approved')
        return res.status(200).json({ success: true, message: 'You are already registered with this shop.', alreadyRegistered: true, status: 'approved' });
      if (existingReg.status === 'pending')
        return res.status(200).json({ success: true, message: 'Your registration is pending approval.', alreadyRegistered: true, status: 'pending' });
      if (existingReg.status === 'rejected')
        return res.status(400).json({ message: 'Your previous registration was rejected. Please contact the shop directly.', rejected: true });
    }

    // ── Role‑specific actions ─────────────────────────────────────────────────
    let displayName = name || req.user.name || req.user.shopName || 'User';

    if (req.user.role === 'customer') {
      // Customer: update their profile and check shopRelations
      const customer = await Customer.findById(req.user.id);
      if (!customer) return res.status(404).json({ message: 'Customer account not found.' });

      const existingRelation = customer.shopRelations?.find(r => r.adminId.toString() === shopId);
      if (existingRelation?.isFlagged) {
        return res.status(403).json({ message: 'You have been flagged by this shop and cannot register.', flagged: true });
      }
      if (existingRelation?.isTrusted) {
        return res.status(200).json({ success: true, message: 'You are already trusted by this shop.', alreadyRegistered: true, status: 'approved' });
      }

      // Update customer fields
      if (name) customer.name = name.trim();
      if (phoneNumber) customer.phoneNumber = phoneNumber.trim();
      if (whatsappNumber) customer.whatsappNumber = whatsappNumber.trim();
      if (address !== undefined) customer.address = address?.trim() || null;
      if (city !== undefined) customer.city = city?.trim() || null;
      await customer.save();
    }
    // For admins/super_admins we do NOT update any model – we just use the provided data.

    // Build final registration data
    const registrationData = {
      customerId: req.user.id,
      shopId,
      shopModel,
      name: displayName,
      email: null,
      phoneNumber: phoneNumber || req.user.phoneNumber || '',
      whatsappNumber: whatsappNumber || req.user.whatsappNumber || phoneNumber || req.user.phoneNumber || '',
      address: address || req.user.address || null,
      city: city || req.user.city || null,
      policyAgreed: true,
      policyAgreedAt: new Date(),
      status: 'pending',
    };

    // Create the registration
    const registration = await ShopRegistration.create(registrationData);

    // Notify the shop owner
    await Notification.create({
      userId: shopId,
      userModel: shopModel === 'Admin' ? 'Admin' : 'SuperAdmin',
      title: 'New Registration Request',
      message: `${displayName} wants to register with your shop.`,
      type: 'customer_registration',
      data: { registrationId: registration._id, customerId: req.user.id, customerName: displayName, phone: registrationData.phoneNumber, city: registrationData.city },
    });

    res.status(201).json({
      success: true,
      message: `Registration request sent to ${shopDoc.shopName || 'the shop'}. You will be notified once approved.`,
      registration: { id: registration._id, status: 'pending', shopName: shopDoc.shopName || 'Shop' },
    });
  } catch (error) {
    console.error('registerWithShop error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'You have already registered with this shop.' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// ── CHECK REGISTRATION STATUS ─────────────────────────────
export const checkShopRegistration = async (req, res) => {
  try {
    const { shopId } = req.params;

    // Prevent checking own shop
    if (req.user.id === shopId) {
      return res.status(200).json({ registered: false, status: 'own_shop', message: 'This is your own shop.' });
    }

    // For customers only, check shopRelations (trusted/flagged)
    if (req.user.role === 'customer') {
      const customer = await Customer.findById(req.user.id);
      if (!customer) return res.status(404).json({ message: 'Customer not found.' });

      const shopRelation = customer.shopRelations?.find(r => r.adminId.toString() === shopId);
      if (shopRelation?.isTrusted) return res.status(200).json({ registered: true, status: 'approved', isTrusted: true });
      if (shopRelation?.isFlagged) return res.status(200).json({ registered: false, status: 'flagged', isFlagged: true, flagReason: shopRelation.flagReason });
    }

    // Generic check for any user (customer, admin, super_admin)
    const registration = await ShopRegistration.findOne({ customerId: req.user.id, shopId }).sort({ createdAt: -1 });
    if (!registration) return res.status(200).json({ registered: false, status: 'not_registered' });

    res.status(200).json({
      registered: true,
      status: registration.status,
      rejectionReason: registration.rejectionReason || null,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};