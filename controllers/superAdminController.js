// controllers/superAdminController.js
import SuperAdmin from '../models/SuperAdmin.js';
import Admin from '../models/Admin.js';
import Customer from '../models/Customer.js';
import Order from '../models/Order.js';
import Price from '../models/Price.js';
import Currency from '../models/Currency.js';
import Picture from '../models/Picture.js';
import Notification from '../models/Notification.js';
import ShopRegistration from '../models/ShopRegistration.js';
import mongoose from 'mongoose';
import { cloudinaryDeleteImage } from '../middleware/upload.js';
import {
  calculatePricePerTola,
  applyPriceDifference,
  fetchAllPrices,
  fetchGoldPriceUSD,
  fetchSilverPriceUSD,
  fetchDollarRatePKR,
  fetchRiyalRatePKR,
  fetchDirhamRatePKR,
  fetchCHFRatePKR,
} from '../utils/goldPriceCalculator.js';
import { generateWhatsAppLink } from '../utils/whatsapp.js';

// ─── Shared helpers ────────────────────────────────────────────────────────────

const round2 = (n) => Math.round(n * 100) / 100;

async function latestSilverDiffs() {
  const doc = await Price.findOne({ type: 'silver' }).sort({ createdAt: -1 }).lean();
  return {
    sellDiff: doc?.diff_silver ?? 0,
    buyDiff: doc?.buy_diff_silver ?? 0,
  };
}


// ── Helper: format order details message ─────────────────────────────
function buildOrderMessage(order, shopName, customerName, status, reason = '') {
  const typeLabel = order.orderType.charAt(0).toUpperCase() + order.orderType.slice(1);
  const metalLabel = order.metalType.charAt(0).toUpperCase() + order.metalType.slice(1);
  const caratStr = order.metalType !== 'currency' && order.carat ? ` (${order.carat})` : '';

  // 📏 Format quantity — use tola + grams for metals, raw unit for currency
  function formatQuantity() {
    if (order.metalType === 'currency') {
      return `${order.quantity} ${order.unit}`;
    }
    // Prefer the pre-built quantityDisplay if it exists
    if (order.quantityDisplay) return order.quantityDisplay;

    // Otherwise, manually build from stored numbers
    const tola = Number(order.quantityInTola) || 0;
    const gram = Number(order.quantityInGram) || 0;
    return `${tola.toFixed(2)} Tola (${gram.toFixed(2)} g)`;
  }

  const quantityStr = formatQuantity();

  // Map emoji and title based on status
  const emojiMap = {
    approved: { icon: '✅', title: 'Order Approved' },
    rejected: { icon: '❌', title: 'Order Update' },
    cancelled: { icon: '❌', title: 'Order Cancelled' },
    completed: { icon: '✅', title: 'Transaction Complete' },
  };
  const { icon, title } = emojiMap[status] || { icon: '📋', title: 'Order Update' };

  // Message base
  let message = `${icon} *${shopName} - ${title}* ${icon}\n\n`;
  message += `Dear ${customerName},\n\n`;

  // Status-specific content
  if (status === 'approved') {
    message += `Your order has been APPROVED! 🎉\n\n`;
    message += `📋 *Order Details:*\n`;
    message += `* Type: ${typeLabel}\n`;
    message += `* Metal: ${metalLabel}${caratStr}\n`;
    message += `* Quantity: ${quantityStr}\n`;
    message += `* Total Amount: PKR ${order.totalAmount.toLocaleString('en-PK')}\n\n`;
    message += `📞 Please visit our shop or contact us to complete payment.\n\n`;
  } else if (status === 'rejected') {
    message += `We regret to inform you that your order has been REJECTED. 📋\n\n`;
    message += `Reason: ${reason || 'Please contact the shop for details.'}\n\n`;
    message += `For more information, please reach out to ${shopName} directly.\n\n`;
  } else if (status === 'cancelled') {
    message += `Your order has been CANCELLED. ⊗\n\n`;
    message += `Reason: ${reason || 'Not specified'}\n\n`;
    message += `If you have any questions, please contact ${shopName}.\n\n`;
  } else if (status === 'completed') {
    message += `Your transaction has been COMPLETED successfully! 🎉\n\n`;
    message += `🧾 Receipt No: ${order.receiptNumber}\n`;
    message += `⚖️ Quantity: ${quantityStr}\n`;

    // Show breakdown if any extra charges or discount exist
    if (order.extraCharges > 0 || order.discount > 0) {
      message += `\n📊 *Breakdown:*\n`;
      message += `• Base Amount: PKR ${(order.completionBaseAmount || order.totalAmount).toLocaleString('en-PK')}\n`;
      if (order.extraCharges > 0) {
        message += `• Extra Charges: +PKR ${order.extraCharges.toLocaleString('en-PK')}\n`;
      }
      if (order.discount > 0) {
        message += `• Discount: -PKR ${order.discount.toLocaleString('en-PK')}\n`;
      }
    }

    message += `\n💰 *Final Amount: PKR ${order.finalizedAmount?.toLocaleString('en-PK')}*\n\n`;
  }

  message += `Thank you for choosing ${shopName}! 🌟\n\n`;
  message += `_This is an automated message._`;

  return message;
}

export const getDashboard = async (req, res) => {
  try {
    const [livePrices, admins] = await Promise.all([
      fetchAllPrices(),
      Admin.find().select('-password'),
    ]);

    // ✅ FIX: If user is admin, find the MAIN Super Admin, not by their own ID
    let sa;
    if (req.user?.role === 'super_admin') {
      sa = await SuperAdmin.findById(req.user.id);
    } else {
      // Admin users - get the first active Super Admin
      sa = await SuperAdmin.findOne({ isActive: true });
    }

    if (!sa) {
      return res.status(404).json({
        success: false,
        message: 'Super admin configuration not found'
      });
    }

    // Get latest silver diffs from Price collection
    const latestSilver = await Price.findOne({ type: 'silver' }).sort({ createdAt: -1 }).lean();
    const silverSellDiff = latestSilver?.diff_silver ?? 0;
    const silverBuyDiff = latestSilver?.buy_diff_silver ?? 0;

    const basePKR_gold = livePrices.gold.pricePerTolaPKR;
    const base2385 = livePrices.gold.price2385PerTolaPKR ??
      Math.round(basePKR_gold * (23.85 / 24) * 100) / 100;
    const basePKR_silver = livePrices.silver.pricePerTolaPKR;

    // Get active admin count
    const activeAdmins = admins.filter(a => a.isActive).length;

    // Build shop list with all required fields
    const shopsList = admins.map((admin) => ({
      _id: admin._id,
      shopName: admin.shopName,
      shopLogo: admin.shopLogo,
      isActive: admin.isActive,
      totalSales: admin.totalSales || 0,
      totalPurchases: admin.totalPurchases || 0,
      salesCount: admin.salesCount || 0,
      purchasesCount: admin.purchasesCount || 0,
      diff_24k: admin.diff_24k || 0,
      diff_2385k: admin.diff_2385k || 0,
      diff_silver: admin.diff_silver || 0,
      buy_diff_24k: admin.buy_diff_24k || 0,
      buy_diff_2385k: admin.buy_diff_2385k || 0,
    }));

    // Add SuperAdmin as a shop too
    shopsList.push({
      _id: sa._id,
      shopName: sa.shopName || 'GoldChain HQ',
      shopLogo: null,
      isActive: true,
      totalSales: sa.totalSales || 0,
      totalPurchases: sa.totalPurchases || 0,
      salesCount: sa.salesCount || 0,
      purchasesCount: sa.purchasesCount || 0,
      diff_24k: sa.diff_24k || 0,
      diff_2385k: sa.diff_2385k || 0,
      diff_silver: sa.diff_silver || 0,
      buy_diff_24k: sa.buy_diff_24k || 0,
      buy_diff_2385k: sa.buy_diff_2385k || 0,
    });

    // Build currency entries with SA's diffs (matching SSE structure)
    const currencyEntries = {};
    for (const [code, data] of Object.entries(livePrices.currencies)) {
      const sellDiff = sa.currencyDiff?.[code] || 0;
      const buyDiff = sa.currencyBuyDiff?.[code] || 0;
      currencyEntries[code] = {
        ...data,
        rate: data.rate,
        liveRate: data.rate,
        difference: sellDiff,
        buy_difference: buyDiff,
        adjustedRate: data.rate + sellDiff,
        buyRate: data.rate + buyDiff,
      };
    }

    res.status(200).json({
      success: true,
      livePrices: {
        gold: {
          priceUSD: livePrices.gold.priceUSD,
          basePricePerTolaPKR: basePKR_gold,
          base2385PerTolaPKR: base2385,
          // Sell prices
          myPrice_24k: applyPriceDifference(basePKR_gold, sa.diff_24k || 0),
          myPrice_2385k: applyPriceDifference(base2385, sa.diff_2385k || 0),
          diff_24k: sa.diff_24k || 0,
          diff_2385k: sa.diff_2385k || 0,
          // Buy prices
          myBuyPrice_24k: applyPriceDifference(basePKR_gold, sa.buy_diff_24k || 0),
          myBuyPrice_2385k: applyPriceDifference(base2385, sa.buy_diff_2385k || 0),
          buy_diff_24k: sa.buy_diff_24k || 0,
          buy_diff_2385k: sa.buy_diff_2385k || 0,
        },
        silver: {
          priceUSD: livePrices.silver.priceUSD,
          basePricePerTolaPKR: basePKR_silver,
          myPrice: applyPriceDifference(basePKR_silver, silverSellDiff),
          diff_silver: silverSellDiff,
          myBuyPrice: applyPriceDifference(basePKR_silver, silverBuyDiff),
          buy_diff_silver: silverBuyDiff,
        },
        currencies: currencyEntries,
        lastUpdated: livePrices.timestamp,
      },
      shops: shopsList,
      stats: {
        totalAdmins: admins.length,
        activeAdmins,
        inactiveAdmins: admins.length - activeAdmins,
      },
    });
  } catch (error) {
    console.error('getDashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load dashboard data',
      error: error.message,
    });
  }
};

// ─── GET SYSTEM HEALTH METRICS ────────────────────────────────────────────────
// Additional endpoint for health score calculation

// ─── GET SYSTEM HEALTH METRICS ────────────────────────────────────────────────
export const getSystemHealth = async (req, res) => {
  try {
    const [
      totalOrders,
      completedOrders,
      cancelledOrders,
      rejectedOrders,
      totalAdmins,
      activeAdmins,
      totalCustomers,
      approvedCustomers,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: 'completed' }),
      Order.countDocuments({ status: 'cancelled' }),
      Order.countDocuments({ status: 'rejected' }),
      Admin.countDocuments(),
      Admin.countDocuments({ isActive: true }),
      Customer.countDocuments(),
      Customer.countDocuments({ status: 'approved' }),
    ]);

    const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
    const activeAdminRate = totalAdmins > 0 ? (activeAdmins / totalAdmins) * 100 : 0;
    const approvedCustomerRate = totalCustomers > 0 ? (approvedCustomers / totalCustomers) * 100 : 0;
    const cancelRate = totalOrders > 0 ? ((cancelledOrders + rejectedOrders) / totalOrders) * 100 : 0;

    const healthScore = Math.round(
      (completionRate * 0.4) +
      (activeAdminRate * 0.3) +
      (approvedCustomerRate * 0.2) +
      (Math.max(0, 100 - cancelRate) * 0.1)
    );

    res.status(200).json({
      success: true,
      healthScore,
      metrics: {
        completionRate: completionRate.toFixed(1),
        activeAdminRate: activeAdminRate.toFixed(1),
        approvedCustomerRate: approvedCustomerRate.toFixed(1),
        cancelFreeRate: Math.max(0, 100 - cancelRate).toFixed(1),
      },
    });
  } catch (error) {
    console.error('getSystemHealth error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── GOLD PRICE DIFFERENCE ─────────────────────────────────────────────────────
export const updatePriceDifference = async (req, res) => {
  try {
    const { diff_24k, diff_2385k, buy_diff_24k, buy_diff_2385k } = req.body;

    if (
      diff_24k === undefined &&
      diff_2385k === undefined &&
      buy_diff_24k === undefined &&
      buy_diff_2385k === undefined
    ) {
      return res.status(400).json({ message: 'At least one price difference field must be provided.' });
    }

    const sa = await SuperAdmin.findById(req.user.id);
    if (!sa) return res.status(404).json({ message: 'Super admin not found.' });

    if (diff_24k !== undefined) sa.diff_24k = Number(diff_24k);
    if (diff_2385k !== undefined) sa.diff_2385k = Number(diff_2385k);
    if (buy_diff_24k !== undefined) sa.buy_diff_24k = Number(buy_diff_24k);
    if (buy_diff_2385k !== undefined) sa.buy_diff_2385k = Number(buy_diff_2385k);
    await sa.save();

    const [goldUSD, dollarPKR] = await Promise.all([fetchGoldPriceUSD(), fetchDollarRatePKR()]);
    const basePKR = calculatePricePerTola(goldUSD, dollarPKR);
    const base2385 = round2(basePKR * (23.85 / 24));

    const adjSell_24k = applyPriceDifference(basePKR, sa.diff_24k ?? 0);
    const adjSell_2385k = applyPriceDifference(base2385, sa.diff_2385k ?? 0);
    const adjBuy_24k = applyPriceDifference(basePKR, sa.buy_diff_24k ?? 0);
    const adjBuy_2385k = applyPriceDifference(base2385, sa.buy_diff_2385k ?? 0);

    await Price.create({
      type: 'gold',
      originalPriceUSD: goldUSD,
      dollarRatePKR: dollarPKR,
      basePricePerTolaPKR: basePKR,
      diff_24k: sa.diff_24k ?? 0,
      diff_2385k: sa.diff_2385k ?? 0,
      buy_diff_24k: sa.buy_diff_24k ?? 0,
      buy_diff_2385k: sa.buy_diff_2385k ?? 0,
      adjustedPrice_24k: adjSell_24k,
      adjustedPrice_2385k: adjSell_2385k,
      adjustedBuyPrice_24k: adjBuy_24k,
      adjustedBuyPrice_2385k: adjBuy_2385k,
      lastUpdatedBy: req.user.id,
    });

    const isBuySide = buy_diff_24k !== undefined || buy_diff_2385k !== undefined;
    const notifTitle = isBuySide ? 'Gold Buy Price Updated' : 'Gold Sell Price Updated';
    const notifMsg = isBuySide
      ? `Gold buy price updated. 24K buy: PKR ${adjBuy_24k.toLocaleString()}/tola`
      : `Gold sell price updated. 24K sell: PKR ${adjSell_24k.toLocaleString()}/tola`;

    const admins = await Admin.find({ isActive: true });
    if (admins.length) {
      await Notification.insertMany(admins.map((a) => ({
        userId: a._id,
        userModel: 'Admin',
        title: notifTitle,
        message: notifMsg,
        type: 'price_update',
        data: {
          diff_24k: sa.diff_24k ?? 0,
          diff_2385k: sa.diff_2385k ?? 0,
          buy_diff_24k: sa.buy_diff_24k ?? 0,
          buy_diff_2385k: sa.buy_diff_2385k ?? 0,
        },
      })));
    }

    res.status(200).json({
      success: true,
      message: `Gold ${isBuySide ? 'buy' : 'sell'} prices updated.`,
      data: {
        diff_24k: sa.diff_24k ?? 0,
        diff_2385k: sa.diff_2385k ?? 0,
        buy_diff_24k: sa.buy_diff_24k ?? 0,
        buy_diff_2385k: sa.buy_diff_2385k ?? 0,
        basePricePerTolaPKR: basePKR,
        adjustedPrice_24k: adjSell_24k,
        adjustedPrice_2385k: adjSell_2385k,
        adjustedBuyPrice_24k: adjBuy_24k,
        adjustedBuyPrice_2385k: adjBuy_2385k,
      },
    });
  } catch (error) {
    console.error('updatePriceDifference error:', error.message);
    res.status(503).json({ message: 'Could not fetch live gold price.', error: error.message });
  }
};

// ── SILVER PRICE DIFFERENCE ───────────────────────────────────────────────────
export const updateSilverPriceDifference = async (req, res) => {
  try {
    const { diff_silver, buy_diff_silver } = req.body;

    if (diff_silver === undefined && buy_diff_silver === undefined) {
      return res.status(400).json({ message: 'diff_silver or buy_diff_silver must be provided.' });
    }

    // ── 1. Load the SuperAdmin and update the fields on the document ─────────
    const sa = await SuperAdmin.findById(req.user.id);
    if (!sa) return res.status(404).json({ message: 'Super admin not found.' });

    if (diff_silver !== undefined) sa.diff_silver = Number(diff_silver);
    if (buy_diff_silver !== undefined) sa.buy_diff_silver = Number(buy_diff_silver);
    await sa.save();  // ← this is the missing line that caused the bug

    // ── 2. Fetch live silver price ────────────────────────────────────────────
    const [silverUSD, dollarPKR] = await Promise.all([
      fetchSilverPriceUSD(),
      fetchDollarRatePKR(),
    ]);
    const basePKR = calculatePricePerTola(silverUSD, dollarPKR);

    const sellDiff = sa.diff_silver;
    const buyDiff = sa.buy_diff_silver;

    const adjSell = applyPriceDifference(basePKR, sellDiff);
    const adjBuy = applyPriceDifference(basePKR, buyDiff);

    // ── 3. Write Price history record ─────────────────────────────────────────
    await Price.create({
      type: 'silver',
      originalPriceUSD: silverUSD,
      dollarRatePKR: dollarPKR,
      basePricePerTolaPKR: basePKR,
      diff_silver: sellDiff,
      buy_diff_silver: buyDiff,
      adjustedPrice_silver: adjSell,
      adjustedBuyPrice_silver: adjBuy,
      lastUpdatedBy: req.user.id,
    });

    // ── 4. Notify admins ──────────────────────────────────────────────────────
    const isBuySide = buy_diff_silver !== undefined;
    const notifMsg = isBuySide
      ? `Silver 999 buy price updated. Buy price: PKR ${adjBuy.toLocaleString()}/tola`
      : `Silver 999 sell price updated. Sell price: PKR ${adjSell.toLocaleString()}/tola`;

    const admins = await Admin.find({ isActive: true });
    if (admins.length) {
      await Notification.insertMany(admins.map((a) => ({
        userId: a._id,
        userModel: 'Admin',
        title: 'Silver Price Updated',
        message: notifMsg,
        type: 'price_update',
        data: { diff_silver: sellDiff, buy_diff_silver: buyDiff },
      })));
    }

    res.status(200).json({
      success: true,
      message: `Silver 999 ${isBuySide ? 'buy' : 'sell'} price updated.`,
      data: {
        diff_silver: sellDiff,
        buy_diff_silver: buyDiff,
        basePricePerTolaPKR: basePKR,
        adjustedPrice_silver: adjSell,
        adjustedBuyPrice_silver: adjBuy,
      },
    });
  } catch (error) {
    console.error('updateSilverPriceDifference error:', error.message);
    res.status(503).json({ message: 'Could not fetch live silver price.', error: error.message });
  }
};

// ── LIVE PRICE STREAM (SSE) ───────────────────────────────────────────────────
// Browser connects once → server pushes fresh prices every 5minutes automatically.
// No page refresh needed. Works with your existing fetchAllPrices cache.

// ── LIVE PRICE STREAM (SSE) ───────────────────────────────────────────────────
export const getLivePriceStream = async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.flushHeaders();

  // Browser connection acknowledgment
  res.write(':ok\n\n');

  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setTimeout(0);
  }

  const sa = await SuperAdmin.findById(req.user.id).lean();

  const sendPrices = async () => {
    try {
      const [livePrices, latestSilverDoc] = await Promise.all([
        fetchAllPrices(),
        Price.findOne({ type: 'silver' }).sort({ createdAt: -1 }).lean(),
      ]);

      const basePKR_gold = livePrices.gold.pricePerTolaPKR;
      const base2385 = livePrices.gold.price2385PerTolaPKR ??
        Math.round(basePKR_gold * (23.85 / 24) * 100) / 100;
      const basePKR_silver = livePrices.silver.pricePerTolaPKR;

      const silverSellDiff = latestSilverDoc?.diff_silver ?? 0;
      const silverBuyDiff = latestSilverDoc?.buy_diff_silver ?? 0;

      // Build adjusted currency rates with SA's diffs
      const adjustedCurrencies = {};
      for (const [code, data] of Object.entries(livePrices.currencies)) {
        const sellDiff = sa.currencyDiff?.[code] ?? 0;
        const buyDiff = sa.currencyBuyDiff?.[code] ?? 0;
        adjustedCurrencies[code] = {
          ...data,
          rate: data.rate,                    // Live rate
          liveRate: data.rate,                // Alias for live rate
          difference: sellDiff,               // Sell diff
          buy_difference: buyDiff,            // Buy diff
          adjustedRate: data.rate + sellDiff, // Sell rate (shop sells to customer)
          buyRate: data.rate + buyDiff,       // Buy rate (shop buys from customer)
        };
      }

      // Build payload matching what frontend expects (same structure as getDashboard)
      const payload = {
        gold: {
          priceUSD: livePrices.gold.priceUSD,
          basePricePerTolaPKR: basePKR_gold,
          base2385PerTolaPKR: base2385,
          // Sell prices (customer buys from shop)
          myPrice_24k: applyPriceDifference(basePKR_gold, sa.diff_24k ?? 0),
          myPrice_2385k: applyPriceDifference(base2385, sa.diff_2385k ?? 0),
          diff_24k: sa.diff_24k ?? 0,
          diff_2385k: sa.diff_2385k ?? 0,
          // Buy prices (customer sells to shop)
          myBuyPrice_24k: applyPriceDifference(basePKR_gold, sa.buy_diff_24k ?? 0),
          myBuyPrice_2385k: applyPriceDifference(base2385, sa.buy_diff_2385k ?? 0),
          buy_diff_24k: sa.buy_diff_24k ?? 0,
          buy_diff_2385k: sa.buy_diff_2385k ?? 0,
        },
        silver: {
          priceUSD: livePrices.silver.priceUSD,
          basePricePerTolaPKR: basePKR_silver,
          // Sell price (customer buys from shop)
          myPrice: applyPriceDifference(basePKR_silver, silverSellDiff),
          diff_silver: silverSellDiff,
          // Buy price (customer sells to shop)
          myBuyPrice: applyPriceDifference(basePKR_silver, silverBuyDiff),
          buy_diff_silver: silverBuyDiff,
        },
        currencies: adjustedCurrencies,
        timestamp: livePrices.timestamp,
      };

      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      console.error('Admin SSE error:', err.message);
      res.write(`data: ${JSON.stringify({ error: 'Price feed temporarily unavailable' })}\n\n`);
    }
  };

  // Send immediately on connect
  await sendPrices();

  // Push every 1 second (1000ms) for real-time per-second ticks
  const interval = setInterval(sendPrices, 1_000);

  // Heartbeat every 20s — keeps alive through proxies/Nginx
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20_000);

  // Clean up when browser disconnects
  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
};

// ── ALL PRICES ─────────────────────────────────────────────────────────────────
export const getAllPrices = async (req, res) => {
  try {
    const [livePrices, latestGold, sa] = await Promise.all([
      fetchAllPrices(),
      Price.findOne({ type: 'gold' }).sort({ createdAt: -1 }).populate('lastUpdatedBy', 'name email'),
      SuperAdmin.findById(req.user.id).select('currencyDiff currencyBuyDiff'),
    ]);

    const latestSilver = await Price.findOne({ type: 'silver' }).sort({ createdAt: -1 });

    // Build currency diffs from SA's own document instead of Currency collection
    const currencyDiffs = {};
    ['USD', 'SAR', 'AED', 'EUR', 'GBP', 'CHF'].forEach((code) => {
      currencyDiffs[code] = {
        difference: sa?.currencyDiff?.[code] ?? 0,
        buy_difference: sa?.currencyBuyDiff?.[code] ?? 0,
      };
    });

    res.status(200).json({
      success: true,
      live: livePrices,
      adjusted: {
        gold: latestGold ?? null,
        silver: latestSilver ?? null,
        currencies: currencyDiffs,
      },
    });
  } catch (error) {
    console.error('getAllPrices error:', error.message);
    res.status(503).json({
      message: 'Live price feed unavailable. Check your API keys.',
      error: error.message,
    });
  }
};

// ── CURRENCY UPDATE ───────────────────────────────────────────────────────────
export const updateCurrency = async (req, res) => {
  try {
    const { currency } = req.params;
    const { difference, buy_difference } = req.body;


    const validCurrencies = ['USD', 'SAR', 'AED', 'EUR', 'GBP', 'CHF'];
    if (!validCurrencies.includes(currency)) {
      return res.status(400).json({ message: `Invalid currency. Use: ${validCurrencies.join(', ')}` });
    }
    if (difference !== undefined && isNaN(Number(difference))) {
      return res.status(400).json({ message: 'difference must be a number.' });
    }
    if (buy_difference !== undefined && isNaN(Number(buy_difference))) {
      return res.status(400).json({ message: 'buy_difference must be a number.' });
    }
    if (difference === undefined && buy_difference === undefined) {
      return res.status(400).json({ message: 'Provide difference or buy_difference.' });
    }

    // ── Save diff on the SuperAdmin's own document (not Currency collection) ──
    const sa = await SuperAdmin.findById(req.user.id);
    if (!sa) return res.status(404).json({ message: 'Super admin not found.' });

    if (difference !== undefined) sa.currencyDiff[currency] = Number(difference);
    if (buy_difference !== undefined) sa.currencyBuyDiff[currency] = Number(buy_difference);

    sa.markModified('currencyDiff');
    sa.markModified('currencyBuyDiff');
    await sa.save();

    // ── Fetch live rate just to return useful info in the response ────────────
    let liveRate;
    if (currency === 'USD') {
      liveRate = await fetchDollarRatePKR();
    } else if (currency === 'SAR') {
      liveRate = await fetchRiyalRatePKR();
    } else if (currency === 'AED') {
      liveRate = await fetchDirhamRatePKR();
    } else {
      const { fetchEurRatePKR, fetchGBPRatePKR, fetchCHFRatePKR } = await import('../utils/goldPriceCalculator.js');
      if (currency === 'EUR') liveRate = await fetchEurRatePKR();
      else if (currency === 'CHF') liveRate = await fetchCHFRatePKR();
      else liveRate = await fetchGBPRatePKR();
    }

    const sellDiff = sa.currencyDiff[currency] ?? 0;
    const buyDiff = sa.currencyBuyDiff[currency] ?? 0;
    const adjustedRate = round2(liveRate + sellDiff);
    const buyRate = round2(liveRate + buyDiff);

    res.status(200).json({
      success: true,
      message: `${currency} ${buy_difference !== undefined ? 'buy' : 'sell'} rate updated.`,
      data: { liveRate, difference: sellDiff, buy_difference: buyDiff, adjustedRate, buyRate },
    });
  } catch (error) {
    console.error('updateCurrency error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── ANALYTICS ──────────────────────────────────────────────────────────────────
export const getAnalytics = async (req, res) => {
  try {
    const now = new Date();

    // ── Time boundaries ───────────────────────────────────────────────────────
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay()); // Sunday

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);

    // ── User counts ──────────────────────────────────────────────────────────
    const [
      totalAdmins,
      activeAdmins,
      totalCustomers,
      approvedCustomers,
    ] = await Promise.all([
      Admin.countDocuments(),
      Admin.countDocuments({ isActive: true }),
      Customer.countDocuments(),
      Customer.countDocuments({ status: 'approved' }),
    ]);

    // ── Order counts (all-time) ──────────────────────────────────────────────
    const [
      totalOrders,
      completedOrders,
      pendingOrders,
      cancelledOrders,
      processingOrders,
      approvedOrders,
      rejectedOrders,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: 'completed' }),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: 'cancelled' }),
      Order.countDocuments({ status: 'processing' }),
      Order.countDocuments({ status: 'approved' }),
      Order.countDocuments({ status: 'rejected' }),
    ]);

    // ── Daily counts ─────────────────────────────────────────────────────────
    const [
      dailyCompleted,
      dailyPending,
      dailyApproved,
      dailyCancelled,
      dailyRejected,
      dailyProcessing,
    ] = await Promise.all([
      Order.countDocuments({ status: 'completed', createdAt: { $gte: startOfToday } }),
      Order.countDocuments({ status: 'pending', createdAt: { $gte: startOfToday } }),
      Order.countDocuments({ status: 'approved', createdAt: { $gte: startOfToday } }),
      Order.countDocuments({ status: 'cancelled', createdAt: { $gte: startOfToday } }),
      Order.countDocuments({ status: 'rejected', createdAt: { $gte: startOfToday } }),
      Order.countDocuments({ status: 'processing', createdAt: { $gte: startOfToday } }),
    ]);

    // ── Weekly counts ────────────────────────────────────────────────────────
    const [
      weeklyCompleted,
      weeklyPending,
      weeklyApproved,
      weeklyCancelled,
      weeklyRejected,
      weeklyProcessing,
    ] = await Promise.all([
      Order.countDocuments({ status: 'completed', createdAt: { $gte: startOfWeek } }),
      Order.countDocuments({ status: 'pending', createdAt: { $gte: startOfWeek } }),
      Order.countDocuments({ status: 'approved', createdAt: { $gte: startOfWeek } }),
      Order.countDocuments({ status: 'cancelled', createdAt: { $gte: startOfWeek } }),
      Order.countDocuments({ status: 'rejected', createdAt: { $gte: startOfWeek } }),
      Order.countDocuments({ status: 'processing', createdAt: { $gte: startOfWeek } }),
    ]);

    // ── Monthly counts ───────────────────────────────────────────────────────
    const [
      monthlyCompleted,
      monthlyPending,
      monthlyApproved,
      monthlyCancelled,
      monthlyRejected,
      monthlyProcessing,
    ] = await Promise.all([
      Order.countDocuments({ status: 'completed', createdAt: { $gte: startOfMonth } }),
      Order.countDocuments({ status: 'pending', createdAt: { $gte: startOfMonth } }),
      Order.countDocuments({ status: 'approved', createdAt: { $gte: startOfMonth } }),
      Order.countDocuments({ status: 'cancelled', createdAt: { $gte: startOfMonth } }),
      Order.countDocuments({ status: 'rejected', createdAt: { $gte: startOfMonth } }),
      Order.countDocuments({ status: 'processing', createdAt: { $gte: startOfMonth } }),
    ]);

    // ── Revenue aggregations (completed orders only) ─────────────────────────
    const revenueAgg = async (dateFilter = {}) => {
      const match = { status: 'completed', ...dateFilter };
      const result = await Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ['$finalizedAmount', '$totalAmount'] } },
            count: { $sum: 1 },
            buyRev: {
              $sum: {
                $cond: [
                  { $eq: ['$orderType', 'buy'] },
                  { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                  0
                ]
              }
            },
            sellRev: {
              $sum: {
                $cond: [
                  { $eq: ['$orderType', 'sell'] },
                  { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                  0
                ]
              }
            },
          },
        },
      ]);
      return result[0] ?? { total: 0, count: 0, buyRev: 0, sellRev: 0 };
    };

    const [totalRevAgg, dailyRevAgg, weeklyRevAgg, monthlyRevAgg] = await Promise.all([
      revenueAgg(),
      revenueAgg({ createdAt: { $gte: startOfToday } }),
      revenueAgg({ createdAt: { $gte: startOfWeek } }),
      revenueAgg({ createdAt: { $gte: startOfMonth } }),
    ]);

    // ── Monthly trend (last 6 months, completed orders only) ─────────────────
    const monthlyTrend = await Order.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 },
          revenue: { $sum: { $ifNull: ['$finalizedAmount', '$totalAmount'] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // ── Order trend (all statuses) for volume chart ──────────────────────────
    const orderTrend = await Order.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          processing: { $sum: { $cond: [{ $eq: ['$status', 'processing'] }, 1, 0] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // ── Metal type breakdown (completed orders only) ─────────────────────────
    const metalBreakdown = await Order.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$metalType',
          count: { $sum: 1 },
          revenue: { $sum: { $ifNull: ['$finalizedAmount', '$totalAmount'] } },
        },
      },
    ]);

    // ── Shop performance ─────────────────────────────────────────────────────
    const shopPerformance = await Admin.find()
      .select('shopName totalSales totalPurchases salesCount purchasesCount isActive')
      .lean();

    // Add SuperAdmin as a "shop" for performance tracking
    const sa = await SuperAdmin.findById(req.user.id)
      .select('shopName totalSales totalPurchases salesCount purchasesCount isActive')
      .lean();

    if (sa) {
      shopPerformance.push({
        _id: sa._id,
        shopName: sa.shopName || 'GoldChain HQ',
        totalSales: sa.totalSales || 0,
        totalPurchases: sa.totalPurchases || 0,
        salesCount: sa.salesCount || 0,
        purchasesCount: sa.purchasesCount || 0,
        isActive: true,
      });
    }

    // ── Price history (last 10 gold price updates) ───────────────────────────
    const priceHistory = await Price.find({ type: 'gold' })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // ── Daily and Weekly order counts for period cards (including all statuses) ──
    const dailyTotal = dailyCompleted + dailyPending + dailyApproved + dailyCancelled + dailyRejected + dailyProcessing;
    const weeklyTotal = weeklyCompleted + weeklyPending + weeklyApproved + weeklyCancelled + weeklyRejected + weeklyProcessing;
    const monthlyTotal = monthlyCompleted + monthlyPending + monthlyApproved + monthlyCancelled + monthlyRejected + monthlyProcessing;

    // ── Response ─────────────────────────────────────────────────────────────
    res.status(200).json({
      success: true,

      users: {
        totalAdmins,
        activeAdmins,
        inactiveAdmins: totalAdmins - activeAdmins,
        totalCustomers,
        approvedCustomers,
        pendingCustomers: totalCustomers - approvedCustomers,
      },

      orders: {
        total: totalOrders,
        completed: completedOrders,
        pending: pendingOrders,
        cancelled: cancelledOrders,
        processing: processingOrders,
        approved: approvedOrders,
        rejected: rejectedOrders || 0,

        daily: {
          completed: dailyCompleted,
          pending: dailyPending,
          approved: dailyApproved,
          cancelled: dailyCancelled,
          rejected: dailyRejected,
          processing: dailyProcessing,
          total: dailyTotal,
        },
        weekly: {
          completed: weeklyCompleted,
          pending: weeklyPending,
          approved: weeklyApproved,
          cancelled: weeklyCancelled,
          rejected: weeklyRejected,
          processing: weeklyProcessing,
          total: weeklyTotal,
        },
        monthly: {
          completed: monthlyCompleted,
          pending: monthlyPending,
          approved: monthlyApproved,
          cancelled: monthlyCancelled,
          rejected: monthlyRejected,
          processing: monthlyProcessing,
          total: monthlyTotal,
        },
      },

      revenue: {
        total: totalRevAgg.total,
        avgPerOrder: totalOrders > 0 ? Math.round(totalRevAgg.total / totalOrders) : 0,
        buyRevenue: totalRevAgg.buyRev,
        sellRevenue: totalRevAgg.sellRev,

        daily: {
          total: dailyRevAgg.total,
          count: dailyRevAgg.count,
          buyRevenue: dailyRevAgg.buyRev,
          sellRevenue: dailyRevAgg.sellRev,
        },
        weekly: {
          total: weeklyRevAgg.total,
          count: weeklyRevAgg.count,
          buyRevenue: weeklyRevAgg.buyRev,
          sellRevenue: weeklyRevAgg.sellRev,
        },
        monthly: {
          total: monthlyRevAgg.total,
          count: monthlyRevAgg.count,
          buyRevenue: monthlyRevAgg.buyRev,
          sellRevenue: monthlyRevAgg.sellRev,
        },
      },

      metalBreakdown: metalBreakdown.map(m => ({
        _id: m._id || 'unknown',
        count: m.count,
        revenue: m.revenue,
      })),

      shopPerformance,
      monthlyTrend: monthlyTrend.map(m => ({
        _id: m._id,
        count: m.count,
        revenue: m.revenue,
      })),
      orderTrend: orderTrend.map(m => ({
        _id: m._id,
        total: m.total,
        completed: m.completed,
        pending: m.pending,
        approved: m.approved,
        cancelled: m.cancelled || 0,
        rejected: m.rejected || 0,
        processing: m.processing || 0,
      })),
      priceHistory: priceHistory.map(p => ({
        _id: p._id,
        createdAt: p.createdAt,
        adjustedPrice_24k: p.adjustedPrice_24k,
        adjustedPrice_2385k: p.adjustedPrice_2385k,
        adjustedBuyPrice_24k: p.adjustedBuyPrice_24k,
        adjustedBuyPrice_2385k: p.adjustedBuyPrice_2385k,
        basePricePerTolaPKR: p.basePricePerTolaPKR,
        diff_24k: p.diff_24k,
        buy_diff_24k: p.buy_diff_24k,
      })),
    });

  } catch (error) {
    console.error('getAnalytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};


// ── MY SHOP ANALYTICS (Super Admin's own shop) ────────────────────────────────
export const getMyShopAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const saId = req.user.id; // SuperAdmin's own ID = their shop's adminId

    // ── Time boundaries ───────────────────────────────────────────────────────
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay()); // Sunday
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);

    // ── Shop info ────────────────────────────────────────────────────────────
    const sa = await SuperAdmin.findById(saId).select('shopName').lean();
    const shopName = sa?.shopName || 'GoldChain HQ';

    // ── Order counts (all-time) for my shop ─────────────────────────────────
    const orderFilter = { adminId: new mongoose.Types.ObjectId(saId) };
    const [
      totalOrders,
      completedOrders,
      pendingOrders,
      approvedOrders,
      rejectedOrders,
      cancelledOrders,
    ] = await Promise.all([
      Order.countDocuments(orderFilter),
      Order.countDocuments({ ...orderFilter, status: 'completed' }),
      Order.countDocuments({ ...orderFilter, status: 'pending' }),
      Order.countDocuments({ ...orderFilter, status: 'approved' }),
      Order.countDocuments({ ...orderFilter, status: 'rejected' }),
      Order.countDocuments({ ...orderFilter, status: 'cancelled' }),
    ]);

    // ── Daily / Weekly / Monthly order counts ────────────────────────────────
    const dailyOrders = await Order.countDocuments({ ...orderFilter, createdAt: { $gte: startOfToday } });
    const dailyCompleted = await Order.countDocuments({ ...orderFilter, status: 'completed', createdAt: { $gte: startOfToday } });
    const dailyApproved = await Order.countDocuments({ ...orderFilter, status: 'approved', createdAt: { $gte: startOfToday } });
    const dailyPending = await Order.countDocuments({ ...orderFilter, status: 'pending', createdAt: { $gte: startOfToday } });
    const dailyRejected = await Order.countDocuments({ ...orderFilter, status: 'rejected', createdAt: { $gte: startOfToday } });
    const dailyCancelled = await Order.countDocuments({ ...orderFilter, status: 'cancelled', createdAt: { $gte: startOfToday } });

    const weeklyOrders = await Order.countDocuments({ ...orderFilter, createdAt: { $gte: startOfWeek } });
    const weeklyCompleted = await Order.countDocuments({ ...orderFilter, status: 'completed', createdAt: { $gte: startOfWeek } });
    const weeklyApproved = await Order.countDocuments({ ...orderFilter, status: 'approved', createdAt: { $gte: startOfWeek } });
    const weeklyPending = await Order.countDocuments({ ...orderFilter, status: 'pending', createdAt: { $gte: startOfWeek } });
    const weeklyRejected = await Order.countDocuments({ ...orderFilter, status: 'rejected', createdAt: { $gte: startOfWeek } });
    const weeklyCancelled = await Order.countDocuments({ ...orderFilter, status: 'cancelled', createdAt: { $gte: startOfWeek } });

    const monthlyOrders = await Order.countDocuments({ ...orderFilter, createdAt: { $gte: startOfMonth } });
    const monthlyCompleted = await Order.countDocuments({ ...orderFilter, status: 'completed', createdAt: { $gte: startOfMonth } });
    const monthlyApproved = await Order.countDocuments({ ...orderFilter, status: 'approved', createdAt: { $gte: startOfMonth } });
    const monthlyPending = await Order.countDocuments({ ...orderFilter, status: 'pending', createdAt: { $gte: startOfMonth } });
    const monthlyRejected = await Order.countDocuments({ ...orderFilter, status: 'rejected', createdAt: { $gte: startOfMonth } });
    const monthlyCancelled = await Order.countDocuments({ ...orderFilter, status: 'cancelled', createdAt: { $gte: startOfMonth } });

    // ── Revenue aggregations (completed orders only) ─────────────────────────
    // IMPORTANT: orderType 'buy' = customer buys from shop = shop's SELL revenue
    //            orderType 'sell' = customer sells to shop = shop's BUY revenue
    const revenueAgg = async (dateFilter = {}) => {
      const match = { ...orderFilter, status: 'completed', ...dateFilter };
      const result = await Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ['$finalizedAmount', '$totalAmount'] } },
            count: { $sum: 1 },
            // SELL revenue = when customer BUYS from shop (orderType: 'buy')
            sellRevenue: {
              $sum: {
                $cond: [
                  { $eq: ['$orderType', 'buy'] },
                  { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                  0
                ]
              }
            },
            // BUY revenue = when customer SELLS to shop (orderType: 'sell')
            buyRevenue: {
              $sum: {
                $cond: [
                  { $eq: ['$orderType', 'sell'] },
                  { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                  0
                ]
              }
            },
            // Count of sales transactions (customer buys)
            salesCount: {
              $sum: { $cond: [{ $eq: ['$orderType', 'buy'] }, 1, 0] }
            },
            // Count of purchase transactions (customer sells)
            purchasesCount: {
              $sum: { $cond: [{ $eq: ['$orderType', 'sell'] }, 1, 0] }
            },
          },
        },
      ]);
      return result[0] ?? {
        total: 0,
        count: 0,
        sellRevenue: 0,
        buyRevenue: 0,
        salesCount: 0,
        purchasesCount: 0,
      };
    };

    const [totalRevAgg, dailyRevAgg, weeklyRevAgg, monthlyRevAgg] = await Promise.all([
      revenueAgg(),
      revenueAgg({ createdAt: { $gte: startOfToday } }),
      revenueAgg({ createdAt: { $gte: startOfWeek } }),
      revenueAgg({ createdAt: { $gte: startOfMonth } }),
    ]);

    // ── Customer counts ──────────────────────────────────────────────────────
    const [totalCustomers, trustedCustomers, flaggedCustomers] = await Promise.all([
      ShopRegistration.countDocuments({ shopId: saId, status: 'approved' }),
      Customer.countDocuments({
        'shopRelations.adminId': saId,
        'shopRelations.isTrusted': true,
      }),
      Customer.countDocuments({
        'shopRelations.adminId': saId,
        'shopRelations.isFlagged': true,
      }),
    ]);

    // ── Monthly trend (last 6 months, completed orders) ─────────────────────
    const monthlyTrend = await Order.aggregate([
      {
        $match: {
          adminId: new mongoose.Types.ObjectId(saId),
          status: 'completed',
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 },
          revenue: { $sum: { $ifNull: ['$finalizedAmount', '$totalAmount'] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // ── Weekly bar chart data (last 7 days, completed only) ─────────────────
    const last7Days = new Date(now);
    last7Days.setDate(now.getDate() - 6);
    last7Days.setHours(0, 0, 0, 0);

    const weeklyData = await Order.aggregate([
      {
        $match: {
          adminId: new mongoose.Types.ObjectId(saId),
          status: 'completed',
          createdAt: { $gte: last7Days }
        }
      },
      {
        $group: {
          _id: { $dayOfWeek: '$createdAt' },
          sales: {
            $sum: {
              $cond: [
                { $eq: ['$orderType', 'buy'] },  // Customer buys = our SELL revenue
                { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                0
              ]
            }
          },
          buys: {
            $sum: {
              $cond: [
                { $eq: ['$orderType', 'sell'] },  // Customer sells = our BUY revenue
                { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                0
              ]
            }
          },
          salesCount: { $sum: { $cond: [{ $eq: ['$orderType', 'buy'] }, 1, 0] } },
          buysCount: { $sum: { $cond: [{ $eq: ['$orderType', 'sell'] }, 1, 0] } },
          totalOrders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const formattedWeeklyData = [];
    for (let i = 1; i <= 7; i++) {
      const found = weeklyData.find(w => w._id === i);
      formattedWeeklyData.push({
        day: DAY_NAMES[i - 1],
        sales: found?.sales || 0,
        buys: found?.buys || 0,
        salesCount: found?.salesCount || 0,
        buysCount: found?.buysCount || 0,
        totalOrders: found?.totalOrders || 0,
      });
    }

    // ── Daily line chart data (last 30 days, completed only) ────────────────
    const last30Days = new Date(now);
    last30Days.setDate(now.getDate() - 29);
    last30Days.setHours(0, 0, 0, 0);

    const dailyData = await Order.aggregate([
      {
        $match: {
          adminId: new mongoose.Types.ObjectId(saId),
          status: 'completed',
          createdAt: { $gte: last30Days }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          sales: {
            $sum: {
              $cond: [
                { $eq: ['$orderType', 'buy'] },  // Customer buys = our SELL revenue
                { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                0
              ]
            }
          },
          buys: {
            $sum: {
              $cond: [
                { $eq: ['$orderType', 'sell'] },  // Customer sells = our BUY revenue
                { $ifNull: ['$finalizedAmount', '$totalAmount'] },
                0
              ]
            }
          },
          salesCount: { $sum: { $cond: [{ $eq: ['$orderType', 'buy'] }, 1, 0] } },
          buysCount: { $sum: { $cond: [{ $eq: ['$orderType', 'sell'] }, 1, 0] } },
          totalOrders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ── Recent orders (last 10) ──────────────────────────────────────────────
    const recentOrders = await Order.find({ adminId: saId })
      .populate('customerId', 'name')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // ── Response ─────────────────────────────────────────────────────────────
    res.status(200).json({
      success: true,
      shopInfo: { shopName },

      orders: {
        total: totalOrders,
        completed: completedOrders,
        pending: pendingOrders,
        approved: approvedOrders,
        rejected: rejectedOrders,
        cancelled: cancelledOrders,

        daily: {
          total: dailyOrders,
          completed: dailyCompleted,
          approved: dailyApproved,
          pending: dailyPending,
          rejected: dailyRejected,
          cancelled: dailyCancelled,
        },
        weekly: {
          total: weeklyOrders,
          completed: weeklyCompleted,
          approved: weeklyApproved,
          pending: weeklyPending,
          rejected: weeklyRejected,
          cancelled: weeklyCancelled,
        },
        monthly: {
          total: monthlyOrders,
          completed: monthlyCompleted,
          approved: monthlyApproved,
          pending: monthlyPending,
          rejected: monthlyRejected,
          cancelled: monthlyCancelled,
        },
      },

      revenue: {
        totalSales: totalRevAgg.sellRevenue + totalRevAgg.buyRevenue,  // Combined total
        totalPurchases: totalRevAgg.buyRevenue,  // Buy revenue only (customer sells)
        sellRevenue: totalRevAgg.sellRevenue,     // SELL revenue (customer buys from shop)
        buyRevenue: totalRevAgg.buyRevenue,       // BUY revenue (customer sells to shop)
        salesCount: totalRevAgg.salesCount,       // Number of sales transactions
        purchasesCount: totalRevAgg.purchasesCount, // Number of purchase transactions

        daily: {
          total: dailyRevAgg.total,
          count: dailyRevAgg.count,
          sellRevenue: dailyRevAgg.sellRevenue,
          buyRevenue: dailyRevAgg.buyRevenue,
        },
        weekly: {
          total: weeklyRevAgg.total,
          count: weeklyRevAgg.count,
          sellRevenue: weeklyRevAgg.sellRevenue,
          buyRevenue: weeklyRevAgg.buyRevenue,
        },
        monthly: {
          total: monthlyRevAgg.total,
          count: monthlyRevAgg.count,
          sellRevenue: monthlyRevAgg.sellRevenue,
          buyRevenue: monthlyRevAgg.buyRevenue,
        },
      },

      customers: {
        total: totalCustomers,
        trusted: trustedCustomers,
        flagged: flaggedCustomers,
      },

      monthlyTrend: monthlyTrend.map(m => ({
        _id: m._id,
        count: m.count,
        revenue: m.revenue,
      })),

      weeklyData: formattedWeeklyData,

      dailyData: dailyData.map(d => ({
        date: d._id,
        sales: d.sales,
        buys: d.buys,
        salesCount: d.salesCount,
        buysCount: d.buysCount,
        totalOrders: d.totalOrders,
      })),

      recentOrders,
    });
  } catch (error) {
    console.error('getMyShopAnalytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};


export const getAllOrders = async (req, res) => {
  try {
    const { status, adminId, orderType, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (adminId) query.adminId = adminId;
    if (orderType) query.orderType = orderType;

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('customerId', 'name email phoneNumber whatsappNumber address city')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Order.countDocuments(query),
    ]);

    // Collect ALL unique adminIds regardless of adminModel
    const allAdminIds = [...new Set(orders.map(o => String(o.adminId)))];

    // Search BOTH collections for ALL ids — this bypasses any wrong adminModel value
    const [adminDocs, superAdminDocs] = await Promise.all([
      Admin.find({ _id: { $in: allAdminIds } })
        .select('shopName name phoneNumber address city')
        .lean(),
      SuperAdmin.find({ _id: { $in: allAdminIds } })
        .select('shopName name phoneNumber address city')
        .lean(),
    ]);

    // Merge into one map — SuperAdmin wins if same ID exists in both (won't happen)
    const shopMap = {};
    adminDocs.forEach(d => { shopMap[String(d._id)] = d; });
    superAdminDocs.forEach(d => { shopMap[String(d._id)] = d; }); // overwrites if SA

    const enriched = orders.map(o => {
      const id = String(o.adminId);
      const doc = shopMap[id];

      o.adminId = doc
        ? {
          _id: doc._id,
          shopName: doc.shopName?.trim() || doc.name?.trim() || 'Shop',
          phoneNumber: doc.phoneNumber || null,
          address: doc.address || null,
          city: doc.city || null,
        }
        : { _id: id, shopName: 'Unknown Shop', phoneNumber: null };

      return o;
    });

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      orders: enriched,
    });
  } catch (error) {
    console.error('getAllOrders error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
// ── MY ORDERS (Super Admin's own shop orders) ─────────────────────────────────
// The Super Admin has their own "shop" identified by their user ID as adminId.
// Orders placed through the SA shop will have adminId === SA._id.
export const getMyOrders = async (req, res) => {
  try {
    const { status, orderType, page = 1, limit = 20 } = req.query;
    const saId = req.user.id;

    const query = { adminId: new mongoose.Types.ObjectId(saId) };
    if (status) query.status = status;
    if (orderType) query.orderType = orderType;

    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('customerId', 'name email phoneNumber whatsappNumber shopRelations') // ← FIXED: 'customerId' not 'customer'
        .populate('adminId', 'shopName phoneNumber')  // This is fine
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Order.countDocuments(query),
    ]);

    res.status(200).json({
      success: true, total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      orders,  // Now orders will have populated customerId with name/email
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── DELETE ORDER ──────────────────────────────────────────────────────────────
export const deleteOrder = async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.id;

    console.log(`Super Admin ${userId} attempting to delete order: ${orderId}`);

    // Find the order
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.'
      });
    }

    // Optional: Prevent deleting completed orders if you want
    // if (order.status === 'completed') {
    //   return res.status(400).json({ 
    //     success: false,
    //     message: 'Cannot delete completed orders. Only pending, approved, or rejected orders can be deleted.' 
    //   });
    // }

    // Store order info for response message
    const orderInfo = {
      id: order._id,
      receiptNumber: order.receiptNumber,
      customerName: order.customerId,
      amount: order.totalAmount,
    };

    // Delete the order
    await Order.deleteOne({ _id: orderId });

    console.log(`Order ${orderId} deleted successfully by Super Admin ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Order deleted successfully.',
      data: {
        deletedOrderId: orderId,
        receiptNumber: order.receiptNumber || 'N/A',
      },
    });
  } catch (error) {
    console.error('deleteOrder error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting order.',
      error: error.message
    });
  }
};

// ── UPDATE ORDER STATUS ───────────────────────────────────────────────────────

// ============================================================
// DROP-IN REPLACEMENT — paste this function into your
// controllers/superAdminController.js (or wherever your
// updateOrderStatus lives).  Replace the existing function
// with this one; everything else in the file stays the same.
// ============================================================

export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the order — must belong to this super-admin's shop
    const order = await Order.findOne({ _id: id, adminId: req.user.id });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const {
      status,
      rejectionReason,
      // Completion-specific fields sent from StatusModal
      finalizedAmount,    // base + extraCharges - discount  (pre-computed on frontend)
      completionBaseAmount, // the base the admin used (original or live-fetched)
      extraCharges,       // number — extra charges applied
      discount,           // number — discount applied
      paymentReceived,    // boolean
    } = req.body;

    // ── Validate transition ───────────────────────────────────────────────────
    const allowed = {
      pending: ["approved", "rejected"],
      approved: ["completed", "cancelled"],
      completed: [],
      rejected: [],
      cancelled: [],
    };

    if (!allowed[order.status]?.includes(status)) {
      return res.status(400).json({
        message: `Cannot move order from "${order.status}" to "${status}"`,
      });
    }

    // ── Apply changes per transition ──────────────────────────────────────────
    order.status = status;

    if (status === "approved") {
      order.approvedBy = req.user.id;
      order.approvedAt = new Date();
    }

    if (status === "rejected" || status === "cancelled") {
      order.rejectionReason = rejectionReason?.trim() || null;
    }

    if (status === "completed") {
      // Validate required completion fields
      const base = parseFloat(completionBaseAmount) || parseFloat(finalizedAmount) || 0;
      const extra = parseFloat(extraCharges) || 0;
      const disc = parseFloat(discount) || 0;
      const final = Math.round((base + extra - disc) * 100) / 100;

      if (final <= 0) {
        return res.status(400).json({ message: "Finalized amount must be positive" });
      }

      // Store all three components so the receipt / detail view can show a breakdown
      order.completionBaseAmount = base;
      order.extraCharges = extra;
      order.discount = disc;
      order.finalizedAmount = final;

      // Payment status
      order.paymentStatus = paymentReceived ? "paid" : "pending";
      order.paymentTime = paymentReceived ? new Date() : null;
    }

    await order.save(); // pre-save hook generates receiptNumber + completedAt

    // ── Notify the customer ───────────────────────────────────────────────────
    // ── Fetch shop & customer for detailed message ──────────────────────
    let shopName = 'GoldChain HQ';
    let customerName = 'Customer';
    try {
      const [sa, customer] = await Promise.all([
        SuperAdmin.findById(req.user.id).select('shopName'),
        Customer.findById(order.customerId).select('name whatsappNumber phoneNumber'),
      ]);
      if (sa?.shopName) shopName = sa.shopName;
      if (customer?.name) customerName = customer.name;
    } catch (err) {
      console.error('Failed to fetch shop/customer for message:', err);
    }

    const detailedMessage = buildOrderMessage(
      order, shopName, customerName, status,
      order.rejectionReason || ''
    );

    // ── Notify the customer ──────────────────────────────────────────────
    try {
      const notif = await Notification.create({
        userId: order.customerId,
        userModel: "Customer",
        title: `Order ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        message: detailedMessage,
        type: "order",          // ← FIXED
        data: { orderId: order._id, status },
      });
      console.log('Notification created:', notif._id);
    } catch (notifErr) {
      console.error("Notification error:", notifErr);
    }

    // ── Build WhatsApp link with detailed message ───────────────────────
    let whatsappLink = null;
    try {
      const customer = await Customer.findById(order.customerId).select("whatsappNumber phoneNumber");
      if (customer) {
        const phone = customer.whatsappNumber || customer.phoneNumber;
        if (phone) whatsappLink = generateWhatsAppLink(phone, detailedMessage);
      }
    } catch (e) {
      console.error("WhatsApp link error:", e);
    }

    return res.status(200).json({
      success: true,
      message: `Order ${status} successfully`,
      order: {
        _id: order._id,
        status: order.status,
        receiptNumber: order.receiptNumber || null,
        finalizedAmount: order.finalizedAmount,
        completionBaseAmount: order.completionBaseAmount,
        extraCharges: order.extraCharges,
        discount: order.discount,
        paymentStatus: order.paymentStatus,
        paymentTime: order.paymentTime,
        approvedAt: order.approvedAt,
        completedAt: order.completedAt,
        rejectionReason: order.rejectionReason,
      },
      whatsappLink,
    });
  } catch (error) {
    console.error("updateOrderStatus error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
// ── ALL CUSTOMERS (system-wide, each customer once) ───────────────────────────
// Each customer appears ONCE. Order counts aggregated across all shops.
// ── ALL CUSTOMERS (system-wide, each customer once) ───────────────────────────
// ── ALL CUSTOMERS (system-wide, each customer once) ───────────────────────────
// Each customer appears ONCE. Order counts aggregated across all shops.
// ── ALL CUSTOMERS (system-wide, each customer once) ───────────────────────────
// Each customer appears ONCE. Order counts aggregated across all shops.
// Only includes customers who have at least ONE approved OR completed order.
// ── ALL CUSTOMERS (system-wide, each customer once) ───────────────────────────
// Only includes customers who have at least ONE approved OR completed order.
// ── ALL CUSTOMERS (system-wide, each customer once) ───────────────────────────
// Only includes customers who have at least ONE approved OR completed order.
// ── ALL CUSTOMERS (system-wide, each customer once) ───────────────────────────

export const getAllCustomers = async (req, res) => {
  try {
    const { isFlagged, page = 1, limit = 20 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const pageLimit = Number(limit);

    // Step 1: Get paginated customer IDs from approved registrations
    const approvedCustomerIds = await ShopRegistration.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: '$customerId' } },
      { $skip: skip },
      { $limit: pageLimit },
      { $project: { _id: 1 } }
    ]);

    const customerIds = approvedCustomerIds.map(c => c._id);

    if (customerIds.length === 0) {
      return res.status(200).json({
        success: true,
        total: 0,
        page: Number(page),
        pages: 0,
        customers: [],
      });
    }

    // Step 2: Get total count for pagination
    const total = await ShopRegistration.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: '$customerId' } },
      { $count: 'total' }
    ]);

    const totalCount = total[0]?.total || 0;

    // Step 3: Get customer details
    const query = { _id: { $in: customerIds } };
    if (isFlagged === 'true') query.isFlagged = true;

    const customers = await Customer.find(query)
      .select('-password')
      .sort({ createdAt: -1 });

    // Step 4: Get completed orders stats
    const orderAggs = await Order.aggregate([
      {
        $match: {
          customerId: { $in: customerIds },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$customerId',
          totalOrders: { $sum: 1 },
          buyOrders: { $sum: { $cond: [{ $eq: ['$orderType', 'buy'] }, 1, 0] } },
          sellOrders: { $sum: { $cond: [{ $eq: ['$orderType', 'sell'] }, 1, 0] } },
          totalSpent: { $sum: { $ifNull: ['$finalizedAmount', '$totalAmount'] } },
          shops: { $addToSet: '$adminId' },
        },
      },
    ]);

    const aggMap = {};
    orderAggs.forEach(a => { aggMap[a._id.toString()] = a; });

    // Step 5: Enrich customers
    const enriched = customers.map(c => {
      const agg = aggMap[c._id.toString()] || {};
      const customerObj = c.toObject();

      let isFlaggedCustomer = false;
      let flagReason = null;

      if (customerObj.shopRelations) {
        const flagged = customerObj.shopRelations.find(r => r.isFlagged === true);
        if (flagged) {
          isFlaggedCustomer = true;
          flagReason = flagged.flagReason;
        }
      }

      return {
        _id: c._id,
        name: c.name,
        email: c.email,
        phoneNumber: c.phoneNumber,
        whatsappNumber: c.whatsappNumber,
        city: c.city,
        address: c.address,
        createdAt: c.createdAt,
        totalOrders: agg.totalOrders || 0,
        buyOrders: agg.buyOrders || 0,
        sellOrders: agg.sellOrders || 0,
        totalSpent: agg.totalSpent || 0,
        shopCount: agg.shops?.length || 0,
        isFlagged: isFlaggedCustomer,
        flagReason: flagReason,
      };
    });

    res.status(200).json({
      success: true,
      total: totalCount,
      page: Number(page),
      pages: Math.ceil(totalCount / pageLimit),
      customers: enriched,
    });

  } catch (error) {
    console.error('getAllCustomers error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
// ── MY CUSTOMERS (Super Admin's own shop customers) ───────────────────────────
// Customers who placed at least one order with the SA shop.
// Each customer appears ONCE; buy/sell counts are for SA shop only.
// ── MY CUSTOMERS (Super Admin's own shop customers) ───────────────────────────
// Customers who placed at least one order with the SA shop.
// Each customer appears ONCE; buy/sell counts are for SA shop only.
// ONLY includes customers with approved OR completed orders.
// ── MY CUSTOMERS (Super Admin's own shop customers) ───────────────────────────
// Customers who placed at least one order with the SA shop.
// Each customer appears ONCE; buy/sell counts are for SA shop only.
// ONLY includes customers with approved OR completed orders.
// ── MY CUSTOMERS (Super Admin's own shop customers) ───────────────────────────

// ── MY CUSTOMERS (Super Admin's own shop customers) ───────────────────────────
export const getMyCustomers = async (req, res) => {
  try {
    const { isFlagged, page = 1, limit = 20 } = req.query;
    const saId = req.user.id;

    const skip = (Number(page) - 1) * Number(limit);
    const pageLimit = Number(limit);

    // Step 1: Get paginated approved registrations
    const registrations = await ShopRegistration.find({
      shopId: saId,
      status: 'approved'
    })
      .populate('customerId', '-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit);

    // Step 2: Get total count
    const total = await ShopRegistration.countDocuments({
      shopId: saId,
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

    // Step 4: Get completed orders stats
    let orderAggs = [];
    if (customerIds.length > 0) {
      orderAggs = await Order.aggregate([
        {
          $match: {
            adminId: new mongoose.Types.ObjectId(saId),
            customerId: { $in: customerIds },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: '$customerId',
            totalOrders: { $sum: 1 },
            buyOrders: { $sum: { $cond: [{ $eq: ['$orderType', 'buy'] }, 1, 0] } },
            sellOrders: { $sum: { $cond: [{ $eq: ['$orderType', 'sell'] }, 1, 0] } },
            totalSpent: { $sum: { $ifNull: ['$finalizedAmount', '$totalAmount'] } },
            lastOrder: { $max: '$createdAt' },
          },
        },
      ]);
    }

    const aggMap = {};
    orderAggs.forEach(a => { aggMap[a._id.toString()] = a; });

    // Step 5: Build customer list
    const customers = registrations.map(reg => {
      const customer = reg.customerId;
      if (!customer) return null;

      const agg = aggMap[customer._id.toString()] || {};
      const customerObj = customer.toObject();

      // Get shop-specific trust/flag
      let isTrusted = false;
      let isFlaggedCustomer = false;
      let flagReason = null;

      if (customerObj.shopRelations) {
        const relation = customerObj.shopRelations.find(r => r.adminId.toString() === saId);
        if (relation) {
          isTrusted = relation.isTrusted || false;
          isFlaggedCustomer = relation.isFlagged || false;
          flagReason = relation.flagReason || null;
        }
      }

      // Get shop customer number
      const shopCustomerNumber = customer.shopCustomerNumbers?.find(
        n => n.adminId.toString() === saId
      )?.number || null;

      return {
        _id: customer._id,
        name: customer.name,
        email: customer.email,
        phoneNumber: customer.phoneNumber,
        whatsappNumber: customer.whatsappNumber,
        city: customer.city,
        address: customer.address,
        createdAt: customer.createdAt,
        totalOrders: agg.totalOrders || 0,
        buyOrders: agg.buyOrders || 0,
        sellOrders: agg.sellOrders || 0,
        totalSpent: agg.totalSpent || 0,
        lastOrder: agg.lastOrder || null,
        shopCustomerNumber: shopCustomerNumber,
        isTrusted: isTrusted,
        isFlagged: isFlaggedCustomer,
        flagReason: flagReason,
      };
    }).filter(c => c !== null);

    // Apply flagged filter
    let filteredCustomers = customers;
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
    console.error('getMyCustomers error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── UPDATE CUSTOMER STATUS ────────────────────────────────────────────────────
export const updateCustomerStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Use: ${validStatuses.join(', ')}` });
    }

    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found.' });

    customer.status = status;
    if (status === 'approved') {
      customer.isActive = true;
      customer.approvedBy = req.user.id;
      customer.approvedAt = new Date();
    }
    if (status === 'rejected' || status === 'pending') {
      customer.isActive = false;
    }
    await customer.save();

    await Notification.create({
      userId: customer._id,
      userModel: 'Customer',
      title: 'Account Status Updated',
      message: `Your account status has been updated to ${status}.`,
      type: 'customer_approval',
      data: { customerId: customer._id },
    });

    res.status(200).json({ success: true, message: `Customer status updated to ${status}.`, customer });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── SUPER ADMIN TRUST CUSTOMER (FOR SUPER ADMIN'S OWN SHOP) ─────────────────────
export const trustCustomerForSA = async (req, res) => {
  try {
    const saId = req.user.id;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const saIdStr = saId.toString();

    const otherRelations = customer.shopRelations.filter(r => r.adminId.toString() !== saIdStr);

    customer.shopRelations = [
      ...otherRelations,
      { adminId: saId, isTrusted: true, isFlagged: false, flaggedBy: null, flagReason: null }
    ];

    await customer.save();

    res.status(200).json({ success: true, message: 'Customer marked as trusted.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── SUPER ADMIN FLAG CUSTOMER (FOR SUPER ADMIN'S OWN SHOP) ─────────────────────
export const flagCustomerForSA = async (req, res) => {
  try {
    const { reason } = req.body;
    const saId = req.user.id;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const saIdStr = saId.toString();

    const otherRelations = customer.shopRelations.filter(r => r.adminId.toString() !== saIdStr);

    customer.shopRelations = [
      ...otherRelations,
      { adminId: saId, isTrusted: false, isFlagged: true, flaggedBy: saId, flagReason: reason || 'Flagged as potential scam' }
    ];

    await customer.save();

    // Notify customer
    const sa = await SuperAdmin.findById(req.user.id);
    await Notification.create({
      userId: customer._id,
      userModel: 'Customer',
      title: 'Account Flagged',
      message: `Your account has been flagged by ${sa.shopName || 'GoldChain HQ'}. Reason: ${reason || 'Not specified'}. You can no longer place orders with this shop.`,
      type: 'customer_flagged',
      data: { adminId: req.user.id, reason: reason || 'Not specified' },
    });

    res.status(200).json({ success: true, message: 'Customer flagged as scam for your shop' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};





// Helper to build phone query matching any Pakistani phone format (+92, 92, 0, or 10 digits)
const buildPhoneQuery = (phoneNumber) => {
  const cleanDigits = String(phoneNumber || '').replace(/\D/g, '');
  if (!cleanDigits) return null;
  const last10 = cleanDigits.slice(-10);
  if (last10.length === 10) {
    return { phoneNumber: new RegExp(`^(\\+92|92|0)?${last10}$`) };
  }
  return { phoneNumber: cleanDigits };
};

// ── ADMIN MANAGEMENT ───────────────────────────────────────────────────────────
export const createAdmin = async (req, res) => {
  try {
    const { name, password, shopName, phoneNumber, whatsappNumber, address, city, tolaWeight } = req.body;

    const phone = String(phoneNumber || '').trim();
    const phoneQuery = buildPhoneQuery(phone);

    if (phoneQuery) {
      const [existsInAdmin, existsInSuperAdmin, existsInCustomer] = await Promise.all([
        Admin.findOne(phoneQuery),
        SuperAdmin.findOne(phoneQuery),
        Customer.findOne(phoneQuery),
      ]);

      if (existsInAdmin || existsInSuperAdmin) {
        return res.status(400).json({ message: 'An account with this phone number already exists.' });
      }

      // If an existing customer account has this phone number, remove the customer entry to allow shop admin creation
      if (existsInCustomer) {
        await Customer.deleteOne({ _id: existsInCustomer._id });
      }
    }

    const admin = await Admin.create({
      name,
      password,
      shopName,
      phoneNumber: phone || null,
      whatsappNumber: whatsappNumber || phone || null,
      address: address || null,
      city: city || null,
      createdBy: req.user.id,
      tolaWeight: tolaWeight,
    });

    res.status(201).json({
      success: true,
      message: 'Shop admin created successfully.',
      admin: {
        id: admin._id, name: admin.name,
        shopName: admin.shopName, phoneNumber: admin.phoneNumber, isActive: admin.isActive,
        tolaWeight: admin.tolaWeight,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getAllAdmins = async (req, res) => {
  try {
    const admins = await Admin.find()
      .select('-password')
      .populate('createdBy', 'name phoneNumber email ')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: admins.length, admins });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getAdminById = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id)
      .select('-password')
      .populate('createdBy', 'name phoneNumber email');
    if (!admin) return res.status(404).json({ message: 'Admin not found.' });
    res.status(200).json({ success: true, admin });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const updateAdmin = async (req, res) => {
  try {
    const {
      name, shopName, phoneNumber, whatsappNumber, tolaWeight,
      address, city, isActive, diff_24k, diff_2385k, diff_silver,
      buy_diff_24k, buy_diff_2385k, buy_diff_silver,
    } = req.body;
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ message: 'Admin not found.' });

    if (phoneNumber !== undefined && phoneNumber !== admin.phoneNumber) {
      const phoneQuery = buildPhoneQuery(phoneNumber);
      if (phoneQuery) {
        const [existsAdmin, existsSA] = await Promise.all([
          Admin.findOne({ ...phoneQuery, _id: { $ne: admin._id } }),
          SuperAdmin.findOne(phoneQuery),
        ]);
        if (existsAdmin || existsSA) {
          return res.status(400).json({ message: 'An account with this phone number already exists.' });
        }
      }
      admin.phoneNumber = phoneNumber;
    }

    if (name !== undefined) admin.name = name;
    if (shopName !== undefined) admin.shopName = shopName;
    if (whatsappNumber !== undefined) admin.whatsappNumber = whatsappNumber;
    if (address !== undefined) admin.address = address;
    if (city !== undefined) admin.city = city;
    if (isActive !== undefined) admin.isActive = isActive;
    if (diff_24k !== undefined) admin.diff_24k = Number(diff_24k);
    if (diff_2385k !== undefined) admin.diff_2385k = Number(diff_2385k);
    if (diff_silver !== undefined) admin.diff_silver = Number(diff_silver);
    if (buy_diff_24k !== undefined) admin.buy_diff_24k = Number(buy_diff_24k);
    if (buy_diff_2385k !== undefined) admin.buy_diff_2385k = Number(buy_diff_2385k);
    if (buy_diff_silver !== undefined) admin.buy_diff_silver = Number(buy_diff_silver);
    if (tolaWeight !== undefined) admin.tolaWeight = Number(tolaWeight);
    await admin.save();

    const adminObj = admin.toObject();
    delete adminObj.password;
    res.status(200).json({ success: true, message: 'Admin updated.', admin: adminObj });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const deleteAdmin = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ message: 'Admin not found.' });
    if (admin.shopLogoPublicId) await cloudinaryDeleteImage(admin.shopLogoPublicId);
    await admin.deleteOne();
    res.status(200).json({ success: true, message: 'Admin deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const toggleAdminStatus = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ message: 'Admin not found.' });
    admin.isActive = !admin.isActive;
    await admin.save();
    res.status(200).json({
      success: true,
      message: `Admin ${admin.isActive ? 'activated' : 'deactivated'}.`,
      isActive: admin.isActive,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const uploadPicture = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Please upload an image file.' });
    const { title, description, type, weight, weightUnit, price, showOnHomePage, showToAdmins } = req.body;

    const picture = await Picture.create({
      uploadedBy: req.user.id,
      uploaderModel: 'SuperAdmin',
      imageUrl: req.file.path,
      cloudinaryPublicId: req.file.filename,
      title: title || null,
      description: description || null,
      type: type || 'gold',
      weight: weight ? Number(weight) : null,
      weightUnit: weightUnit || 'gram',          // <-- ADD THIS
      price: price ? Number(price) : null,
      showOnHomePage: showOnHomePage !== 'false',
      showToAdmins: showToAdmins !== 'false',
    });

    res.status(201).json({ success: true, message: 'Picture uploaded.', picture });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getPictures = async (req, res) => {
  try {
    const pictures = await Picture.find({
      uploadedBy: req.user.id, uploaderModel: 'SuperAdmin', isActive: true,
    }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: pictures.length, pictures });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const deletePicture = async (req, res) => {
  try {
    const picture = await Picture.findOne({ _id: req.params.id, uploadedBy: req.user.id });
    if (!picture) return res.status(404).json({ message: 'Picture not found.' });
    await cloudinaryDeleteImage(picture.cloudinaryPublicId);
    picture.isActive = false;
    await picture.save();
    res.status(200).json({ success: true, message: 'Picture deleted.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── UPDATE PICTURE ─────────────────────────────────────────────────────────────
export const updatePicture = async (req, res) => {
  try {
    const { id } = req.params;
    const picture = await Picture.findOne({ _id: id, uploadedBy: req.user.id });
    if (!picture) return res.status(404).json({ message: 'Picture not found.' });

    const {
      title,
      description,
      type,
      weight,
      weightUnit,
      price,
      showOnHomePage,
      showToAdmins,
    } = req.body;

    // Update text fields only if provided
    if (title !== undefined) picture.title = title || null;
    if (description !== undefined) picture.description = description || null;
    if (type !== undefined) picture.type = type;
    if (weight !== undefined) picture.weight = weight !== '' ? Number(weight) : null;
    if (weightUnit !== undefined) picture.weightUnit = weightUnit;
    if (price !== undefined) picture.price = price !== '' ? Number(price) : null;
    if (showOnHomePage !== undefined) picture.showOnHomePage = showOnHomePage !== 'false';
    if (showToAdmins !== undefined) picture.showToAdmins = showToAdmins !== 'false';

    // If a new image file is uploaded, replace the Cloudinary image
    if (req.file) {
      // Delete the old image from Cloudinary
      if (picture.cloudinaryPublicId) {
        await cloudinaryDeleteImage(picture.cloudinaryPublicId);
      }
      picture.imageUrl = req.file.path;
      picture.cloudinaryPublicId = req.file.filename;
    }

    await picture.save();

    res.status(200).json({ success: true, message: 'Picture updated.', picture });
  } catch (error) {
    console.error('updatePicture error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── NOTIFICATIONS ──────────────────────────────────────────────────────────────
export const getNotifications = async (req, res) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ userId: req.user.id, userModel: 'SuperAdmin' })
        .sort({ createdAt: -1 }).limit(50),
      Notification.countDocuments({ userId: req.user.id, userModel: 'SuperAdmin', isRead: false }),
    ]);
    res.status(200).json({ success: true, unreadCount, notifications });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { isRead: true }
    );
    res.status(200).json({ success: true, message: 'Notification marked as read.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user.id, userModel: 'SuperAdmin', isRead: false },
      { isRead: true }
    );
    res.status(200).json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


export const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user.id,
      userModel: 'SuperAdmin'
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

// ── PROFILE ────────────────────────────────────────────────────────────────────
// In superAdminController.js updateProfile
export const updateProfile = async (req, res) => {
  try {
    const { name, shopName, phoneNumber, whatsappNumber, address, city, removeLogo } = req.body;
    const sa = await SuperAdmin.findById(req.user.id);
    if (!sa) return res.status(404).json({ message: 'Super admin not found.' });

    if (name !== undefined) sa.name = name.trim();
    if (shopName !== undefined) sa.shopName = shopName.trim();
    if (phoneNumber !== undefined) sa.phoneNumber = phoneNumber.trim();
    if (whatsappNumber !== undefined) sa.whatsappNumber = whatsappNumber.trim();
    if (address !== undefined) sa.address = address.trim();
    if (city !== undefined) sa.city = city.trim();

    // Handle logo removal
    if (removeLogo === 'true') {
      if (sa.shopLogoPublicId) {
        await cloudinaryDeleteImage(sa.shopLogoPublicId);
      }
      sa.shopLogo = null;
      sa.shopLogoPublicId = null;
    }
    // Handle logo upload
    else if (req.file) {
      // Delete old logo from Cloudinary if exists
      if (sa.shopLogoPublicId) {
        await cloudinaryDeleteImage(sa.shopLogoPublicId);
      }
      sa.shopLogo = req.file.path;
      sa.shopLogoPublicId = req.file.filename;
    }

    await sa.save();
    // Return the updated user object
    res.status(200).json({ success: true, user: sa });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const handleDeleteLogo = async () => {
  if (!shopLogo && !logoPreview) return;
  if (!window.confirm("Are you sure you want to remove the shop logo?")) return;

  // If there's a preview but no saved logo, just clear the preview
  if (logoPreview && !shopLogo) {
    setLogoFile(null);
    setLogoPreview(null);
    return;
  }

  setPfSaving(true);
  try {
    const formData = new FormData();
    formData.append("removeLogo", "true");
    formData.append("name", pf.name.trim());
    if (pf.shopName.trim()) formData.append("shopName", pf.shopName.trim());
    if (pf.phoneNumber.trim()) formData.append("phoneNumber", pf.phoneNumber.trim());
    if (pf.whatsappNumber.trim()) formData.append("whatsappNumber", pf.whatsappNumber.trim());
    if (pf.address.trim()) formData.append("address", pf.address.trim());
    if (pf.city.trim()) formData.append("city", pf.city.trim());

    const res = await saAPI.updateSAProfile(formData);
    const updated = res.data?.user ?? res.data;
    if (setUser && updated) setUser((p) => ({ ...p, ...updated }));
    setShopLogo(null);
    setLogoFile(null);
    setLogoPreview(null);
    showToast("Logo removed successfully.");
  } catch (err) {
    showToast(err.response?.data?.message || "Failed to remove logo.", "error");
  } finally {
    setPfSaving(false);
  }
};

export const unflagCustomerForSA = async (req, res) => {
  try {
    const saId = req.user.id;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const saIdStr = saId.toString();

    // Filter out all relations for this shop
    const otherRelations = customer.shopRelations.filter(
      r => r.adminId.toString() !== saIdStr
    );

    // Get the relations for this shop
    const shopRelations = customer.shopRelations.filter(
      r => r.adminId.toString() === saIdStr
    );

    if (shopRelations.length > 0) {
      // Take the last one and unflag it
      const lastRel = shopRelations[shopRelations.length - 1];
      lastRel.isFlagged = false;
      lastRel.flagReason = null;
      lastRel.flaggedBy = null;

      // Replace with cleaned version
      customer.shopRelations = [...otherRelations, lastRel];
    }

    await customer.save();

    res.status(200).json({ success: true, message: 'Flag removed from customer.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const untrustCustomerForSA = async (req, res) => {
  try {
    const saId = req.user.id;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const saIdStr = saId.toString();
    const otherRelations = customer.shopRelations.filter(r => r.adminId.toString() !== saIdStr);
    const shopRelations = customer.shopRelations.filter(r => r.adminId.toString() === saIdStr);

    if (shopRelations.length > 0) {
      const lastRel = shopRelations[shopRelations.length - 1];
      lastRel.isTrusted = false;
      customer.shopRelations = [...otherRelations, lastRel];
    }

    await customer.save();
    res.status(200).json({ success: true, message: 'Trusted status removed.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// Add to superAdminController.js

// ── GET CUSTOMER WITH SHOPS AND ORDERS ─────────────────────────────────────────

export const getCustomerWithDetails = async (req, res) => {
  try {
    const customerId = req.params.id;

    const customer = await Customer.findById(customerId).select('-password');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    // Get all shops the customer has traded with
    const shopIds = customer.shopRelations?.map(r => r.adminId) || [];
    const shops = await Admin.find({ _id: { $in: shopIds } }).select('shopName phoneNumber address city');
    const superAdminShops = await SuperAdmin.find({ _id: { $in: shopIds } }).select('shopName phoneNumber address city');

    const allShops = [...shops, ...superAdminShops];

    // Get all orders with shop details
    const orders = await Order.find({ customerId: customer._id })
      .populate({
        path: 'adminId',
        select: 'shopName phoneNumber address city name',
        model: 'Admin'
      })
      .sort({ createdAt: -1 });

    // Enrich orders - try SuperAdmin if Admin not found
    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      const orderObj = order.toObject();
      if (!orderObj.adminId || (orderObj.adminId && !orderObj.adminId.shopName)) {
        const superAdmin = await SuperAdmin.findById(order.adminId).select('shopName phoneNumber address city name');
        if (superAdmin) {
          orderObj.adminId = {
            _id: superAdmin._id,
            shopName: superAdmin.shopName || superAdmin.name,
            phoneNumber: superAdmin.phoneNumber,
            address: superAdmin.address,
            city: superAdmin.city
          };
        }
      }
      return orderObj;
    }));

    // Get order statistics - only count completed orders for revenue
    const completedOrders = orders.filter(o => o.status === 'completed');
    const orderStats = {
      total: orders.length,
      pending: orders.filter(o => o.status === 'pending').length,
      approved: orders.filter(o => o.status === 'approved').length,
      completed: completedOrders.length,
      rejected: orders.filter(o => o.status === 'rejected').length,
      buyOrders: orders.filter(o => o.orderType === 'buy').length,
      sellOrders: orders.filter(o => o.orderType === 'sell').length,
      // Only sum completed orders for revenue
      totalSpent: completedOrders.reduce((sum, o) => sum + (o.finalizedAmount || o.totalAmount || 0), 0),
    };

    // Get per-shop trust/flag status
    const shopStatuses = (customer.shopRelations || []).map(rel => ({
      shopId: rel.adminId,
      isTrusted: rel.isTrusted || false,
      isFlagged: rel.isFlagged || false,
      flagReason: rel.flagReason || null,
    }));

    // Get customer's trust/flag status from the most recent shop relation
    const lastRelation = customer.shopRelations?.[customer.shopRelations.length - 1];

    res.status(200).json({
      success: true,
      customer: {
        ...customer.toObject(),
        shops: allShops,
        shopStatuses,
        orders: enrichedOrders,
        orderStats,
        isTrusted: lastRelation?.isTrusted || false,
        isFlagged: lastRelation?.isFlagged || false,
        flagReason: lastRelation?.flagReason || null,
      },
    });
  } catch (error) {
    console.error('getCustomerWithDetails error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── GET CUSTOMER ORDERS WITH PAGINATION ────────────────────────────────────────
export const getCustomerOrders = async (req, res) => {
  try {
    const customerId = req.params.id;
    const { status, orderType, page = 1, limit = 20, search } = req.query;

    const query = { customerId: new mongoose.Types.ObjectId(customerId) };
    if (status && status !== 'all') query.status = status;
    if (orderType && orderType !== 'all') query.orderType = orderType;

    const skip = (Number(page) - 1) * Number(limit);

    // Get orders
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Order.countDocuments(query);

    // Enrich orders with shop names from both Admin and SuperAdmin
    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      const orderObj = { ...order };

      // Determine which model to use based on adminModel or by checking both
      let shop = null;

      // First try based on adminModel if it exists
      if (order.adminModel === 'SuperAdmin') {
        shop = await SuperAdmin.findById(order.adminId).select('shopName name phoneNumber address city').lean();
      } else {
        // Try Admin first
        shop = await Admin.findById(order.adminId).select('shopName name phoneNumber address city').lean();
        // If not found, try SuperAdmin
        if (!shop) {
          shop = await SuperAdmin.findById(order.adminId).select('shopName name phoneNumber address city').lean();
        }
      }

      if (shop) {
        orderObj.adminId = {
          _id: shop._id,
          shopName: shop.shopName || shop.name || 'Shop',
          phoneNumber: shop.phoneNumber,
          address: shop.address,
          city: shop.city
        };
      } else {
        // Fallback to registration data
        const registration = await ShopRegistration.findOne({
          customerId: customerId,
          shopId: order.adminId,
          status: 'approved'
        }).lean();

        if (registration) {
          orderObj.adminId = {
            _id: order.adminId,
            shopName: registration.name || 'Registered Shop',
            phoneNumber: registration.phoneNumber
          };
        } else {
          orderObj.adminId = {
            _id: order.adminId,
            shopName: `Shop ID: ${order.adminId.toString().slice(-6)}`,
            phoneNumber: 'N/A'
          };
        }
      }

      return orderObj;
    }));

    res.status(200).json({
      success: true,
      orders: enrichedOrders,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    console.error('getCustomerOrders error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};