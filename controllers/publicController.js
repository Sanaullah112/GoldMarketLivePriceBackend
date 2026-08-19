// ============================================================
// controllers/publicController.js  — No auth required (home page)
// ============================================================
import Admin from '../models/Admin.js';
import SuperAdmin from '../models/SuperAdmin.js';
import Picture from '../models/Picture.js';
import Currency from '../models/Currency.js';
import { fetchAllPrices, applyPriceDifference } from '../utils/goldPriceCalculator.js';
import { generateWhatsAppLink } from '../utils/whatsapp.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const buildCurrencyMap = (currencies) => {
  const map = {};
  currencies.forEach((c) => { map[c.currency] = c; });
  return map;
};

const buildCurrencyResponse = (liveCurrencies, currencyMap, shopDoc = null) =>
  Object.fromEntries(
    Object.entries(liveCurrencies).map(([code, data]) => {
      const dbC = currencyMap[code];

      let sellRate, buyRate;

      if (!shopDoc) {
        // Global market prices ticker — use Currency collection (no specific shop)
        sellRate = data.rate + (dbC?.difference ?? 0);
        buyRate = data.rate + (dbC?.buy_difference ?? 0);
      } else {
        // Any shop (SuperAdmin or Admin) — use only that shop's own currencyDiff fields
        sellRate = data.rate + (shopDoc.currencyDiff?.[code] ?? 0);
        buyRate = data.rate + (shopDoc.currencyBuyDiff?.[code] ?? 0);
      }

      return [code, {
        rate: data.rate,
        sellRate,
        buyRate,
        name: data.name,
        symbol: data.symbol,
      }];
    })
  );

const buildShopPrices = (basePKR_24k, base2385, baseSilver, doc) => ({
  sell_24k: applyPriceDifference(basePKR_24k, doc.diff_24k ?? 0),
  sell_2385k: applyPriceDifference(base2385, doc.diff_2385k ?? 0),
  buy_24k: applyPriceDifference(basePKR_24k, doc.buy_diff_24k ?? 0),
  buy_2385k: applyPriceDifference(base2385, doc.buy_diff_2385k ?? 0),
  sell_silver: applyPriceDifference(baseSilver, doc.diff_silver ?? 0),
  buy_silver: applyPriceDifference(baseSilver, doc.buy_diff_silver ?? 0),
});

// ─── GET HOME PAGE ────────────────────────────────────────────────────────────

export const getHomePage = async (req, res) => {
  try {
    const [admins, superAdmins, livePrices, currencies, pictures] = await Promise.all([
      Admin.find({ isActive: true }).select(
        'shopName shopLogo phoneNumber tolaWeight whatsappNumber address city diff_24k diff_2385k diff_silver buy_diff_24k buy_diff_2385k buy_diff_silver currencyDiff currencyBuyDiff'
      ),
      SuperAdmin.find({ isActive: true }).select(
        'shopName phoneNumber tolaWeight whatsappNumber address city diff_24k diff_2385k diff_silver buy_diff_24k buy_diff_2385k buy_diff_silver profilePicture currencyDiff currencyBuyDiff'
      ),
      fetchAllPrices(),
      Currency.find(),
      Picture.find({ showOnHomePage: true, isActive: true })
        .sort({ createdAt: -1 })
        .limit(20),
    ]);

    const currencyMap = buildCurrencyMap(currencies);
    const basePKR_24k = livePrices.gold.pricePerTolaPKR;
    const base2385 = Math.round((basePKR_24k * (23.85 / 24)) * 100) / 100;
    const baseSilver = livePrices.silver.pricePerTolaPKR;

    const adminShops = admins.map((a) => ({
      id: a._id,
      shopName: a.shopName,
      shopLogo: a.shopLogo,
      phoneNumber: a.phoneNumber,
      whatsappNumber: a.whatsappNumber || a.phoneNumber,
      address: a.address,
      city: a.city,
      tolaWeight: a.tolaWeight,
      shopType: 'admin',
      prices: buildShopPrices(basePKR_24k, base2385, baseSilver, a),
      currencies: buildCurrencyResponse(livePrices.currencies, currencyMap, a),
      whatsappLink: generateWhatsAppLink(
        a.whatsappNumber || a.phoneNumber || '',
        `Hello ${a.shopName}, I would like to inquire about gold prices.`
      ),
    }));

    const saShops = superAdmins.map((sa) => ({
      id: sa._id,
      shopName: sa.shopName || 'GoldChain HQ',
      shopLogo: sa.profilePicture || null,
      phoneNumber: sa.phoneNumber,
      whatsappNumber: sa.whatsappNumber || sa.phoneNumber,
      address: sa.address,
      city: sa.city,
      tolaWeight: sa.tolaWeight,
      shopType: 'super_admin',
      prices: buildShopPrices(basePKR_24k, base2385, baseSilver, sa),
      currencies: buildCurrencyResponse(livePrices.currencies, currencyMap, sa),
      whatsappLink: generateWhatsAppLink(
        sa.whatsappNumber || sa.phoneNumber || '',
        `Hello ${sa.shopName || 'GoldChain HQ'}, I would like to inquire about gold prices.`
      ),
    }));

    res.status(200).json({
      success: true,
      // tolaWeight: tolaWeight,
      marketPrices: {
        gold: {
          per_oz_USD: livePrices.gold.priceUSD,
          per_tola_PKR_24k: basePKR_24k,
          per_tola_PKR_2385k: base2385,
        },
        silver: {
          per_oz_USD: livePrices.silver.priceUSD,
          per_tola_PKR: baseSilver,
        },
        currencies: buildCurrencyResponse(livePrices.currencies, currencyMap),
        lastUpdated: livePrices.timestamp,
      },
      shops: [...saShops, ...adminShops],
      pictures,
      policy: 'Price locked at time of payment. If payment is not received promptly, current market price applies at time of visit.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── GET LIVE PRICES ──────────────────────────────────────────────────────────

export const getLivePrices = async (req, res) => {
  try {
    const [livePrices, currencies] = await Promise.all([fetchAllPrices(), Currency.find()]);
    const currencyMap = buildCurrencyMap(currencies);
    const basePKR_24k = livePrices.gold.pricePerTolaPKR;
    const base2385 = Math.round((basePKR_24k * (23.85 / 24)) * 100) / 100;

    res.status(200).json({
      success: true,
      gold: {
        priceUSD: livePrices.gold.priceUSD,
        pricePerTola_24k_PKR: basePKR_24k,
        pricePerTola_2385k_PKR: base2385,
      },
      silver: {
        priceUSD: livePrices.silver.priceUSD,
        pricePerTolaPKR: livePrices.silver.pricePerTolaPKR,
      },
      currencies: buildCurrencyResponse(livePrices.currencies, currencyMap),
      timestamp: livePrices.timestamp,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── GET SHOP DETAIL (public — no auth required) ──────────────────────────────

export const getShopDetail = async (req, res) => {
  try {
    const { id } = req.params;

    let shopDoc = null;
    let shopType = 'admin';

    shopDoc = await Admin.findOne({ _id: id, isActive: true }).select(
      'shopName shopLogo phoneNumber whatsappNumber tolaWeight address city diff_24k diff_2385k diff_silver buy_diff_24k buy_diff_2385k buy_diff_silver currencyDiff currencyBuyDiff'
    );

    if (!shopDoc) {
      shopDoc = await SuperAdmin.findOne({ _id: id, isActive: true }).select(
        'shopName profilePicture phoneNumber whatsappNumber tolaWeight address city diff_24k diff_2385k diff_silver buy_diff_24k buy_diff_2385k buy_diff_silver currencyDiff currencyBuyDiff'
      );
      shopType = shopDoc ? 'super_admin' : null;
    }
    console.log("SHOP data :", shopDoc);

    if (!shopDoc) return res.status(404).json({ message: 'Shop not found.' });

    const [livePrices, currencies, pictures] = await Promise.all([
      fetchAllPrices(),
      Currency.find(),
      Picture.find({
        uploadedBy: shopDoc._id,
        uploaderModel: shopType === 'admin' ? 'Admin' : 'SuperAdmin',
        showOnHomePage: true,
        isActive: true,
      }).sort({ createdAt: -1 }).limit(20),
    ]);

    const currencyMap = buildCurrencyMap(currencies);
    const basePKR_24k = livePrices.gold.pricePerTolaPKR;
    const base2385 = Math.round((basePKR_24k * (23.85 / 24)) * 100) / 100;
    const baseSilver = livePrices.silver.pricePerTolaPKR;
    const shopLogo = shopType === 'admin' ? shopDoc.shopLogo : shopDoc.profilePicture;

    res.status(200).json({
      success: true,
      shop: {
        id: shopDoc._id,
        shopName: shopDoc.shopName || 'GoldChain HQ',
        shopLogo: shopLogo || null,
        phoneNumber: shopDoc.phoneNumber,
        whatsappNumber: shopDoc.whatsappNumber || shopDoc.phoneNumber,
        address: shopDoc.address,
        city: shopDoc.city,
        shopType,
        tolaWeight: shopDoc.tolaWeight,
        prices: buildShopPrices(basePKR_24k, base2385, baseSilver, shopDoc),
        currencies: buildCurrencyResponse(livePrices.currencies, currencyMap, shopDoc),
        whatsappLink: generateWhatsAppLink(
          shopDoc.whatsappNumber || shopDoc.phoneNumber || '',
          `Hello ${shopDoc.shopName || 'GoldChain HQ'}, I would like to inquire about gold prices.`
        ),
      },
      pictures,
      marketPrices: {
        gold: {
          per_oz_USD: livePrices.gold.priceUSD,
          per_tola_PKR_24k: basePKR_24k,
          per_tola_PKR_2385k: base2385,
        },
        silver: {
          per_oz_USD: livePrices.silver.priceUSD,
          per_tola_PKR: baseSilver,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── PUBLIC SSE LIVE PRICE STREAM (30-second real-time updates) ──────────────
export const getPublicLivePriceStream = async (req, res) => {
  // Set SSE headers - prevents buffering and keeps connection alive
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx/proxy buffering
  res.flushHeaders();

  // Send initial connection confirmation
  res.write(':connected\n\n');

  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setTimeout(0);
  }

  let intervalId = null;
  let heartbeatId = null;
  let isClosed = false;

  let goldOffset = 0;
  let silverOffset = 0;
  let goldUsdOffset = 0;
  let silverUsdOffset = 0;

  const sendPrices = async () => {
    if (isClosed) return;

    try {
      const livePrices = await fetchAllPrices();

      // Micro-fluctuations for active 1-second market ticks
      const deltaGold = (Math.random() - 0.49) * 4;
      const deltaSilver = (Math.random() - 0.49) * 0.2;
      const deltaGoldUsd = (Math.random() - 0.49) * 0.8;
      const deltaSilverUsd = (Math.random() - 0.49) * 0.04;

      goldOffset = Math.max(-50, Math.min(50, goldOffset + deltaGold));
      silverOffset = Math.max(-5, Math.min(5, silverOffset + deltaSilver));
      goldUsdOffset = Math.max(-10, Math.min(10, goldUsdOffset + deltaGoldUsd));
      silverUsdOffset = Math.max(-1, Math.min(1, silverUsdOffset + deltaSilverUsd));

      const base24k = Math.round((livePrices.gold.pricePerTolaPKR + goldOffset) * 100) / 100;
      const base2385k = Math.round((base24k * (23.85 / 24)) * 100) / 100;
      const baseSilver = Math.round((livePrices.silver.pricePerTolaPKR + silverOffset) * 100) / 100;
      const liveGoldUsd = Math.round((livePrices.gold.priceUSD + goldUsdOffset) * 100) / 100;
      const liveSilverUsd = Math.round((livePrices.silver.priceUSD + silverUsdOffset) * 100) / 100;

      const formattedPrices = {
        gold: {
          priceUSD: liveGoldUsd,
          per_tola_PKR_24k: base24k,
          per_tola_PKR_2385k: base2385k,
        },
        silver: {
          priceUSD: liveSilverUsd,
          per_tola_PKR: baseSilver,
        },
        currencies: Object.fromEntries(
          Object.entries(livePrices.currencies).map(([code, data]) => [
            code,
            {
              rate: data.rate,
              name: data.name,
              symbol: data.symbol,
            }
          ])
        ),
        timestamp: new Date(),
      };

      res.write(`data: ${JSON.stringify(formattedPrices)}\n\n`);

    } catch (err) {
      console.error('SSE price fetch error:', err.message);
      if (!isClosed) {
        res.write(`data: ${JSON.stringify({ error: 'Price feed temporarily unavailable' })}\n\n`);
      }
    }
  };

  // Send first update immediately
  await sendPrices();

  // Push updates every 1 second (1000ms) for real-time per-second ticks
  intervalId = setInterval(sendPrices, 1_000);

  // Send heartbeat every 15 seconds to keep connection alive through proxies
  heartbeatId = setInterval(() => {
    if (!isClosed) {
      res.write(':heartbeat\n\n');
    }
  }, 15_000);

  // Clean up when client disconnects
  req.on('close', () => {
    isClosed = true;
    if (intervalId) clearInterval(intervalId);
    if (heartbeatId) clearInterval(heartbeatId);
    console.log('Public SSE connection closed');
  });
};



// ─── GET PUBLIC LIVE PRICES FOR HOMEPAGE (No auth required) ──────────────────
export const getPublicLivePrices = async (req, res) => {
  try {
    const livePrices = await fetchAllPrices();

    // Format prices for public display (no admin diffs)
    const formattedPrices = {
      gold: {
        priceUSD: livePrices.gold.priceUSD,
        per_tola_PKR_24k: livePrices.gold.pricePerTolaPKR,
        per_tola_PKR_2385k: livePrices.gold.price2385PerTolaPKR,
      },
      silver: {
        priceUSD: livePrices.silver.priceUSD,
        per_tola_PKR: livePrices.silver.pricePerTolaPKR,
      },
      currencies: Object.fromEntries(
        Object.entries(livePrices.currencies).map(([code, data]) => [
          code,
          {
            rate: data.rate,
            name: data.name,
            symbol: data.symbol,
          }
        ])
      ),
      timestamp: livePrices.timestamp,
    };

    res.status(200).json({
      success: true,
      prices: formattedPrices,
      lastUpdated: livePrices.timestamp,
    });
  } catch (error) {
    console.error('getPublicLivePrices error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch live prices',
      error: error.message
    });
  }
};


// ------- GET /api/public/pictures
export const getPublicPictures = async (req, res) => {
  try {
    const pictures = await Picture.find({
      isActive: true,
      showOnHomePage: true,
    })
      .populate({
        path: "uploadedBy",
        select: "shopName phoneNumber whatsappNumber whatsappLink",
      })
      .sort({ createdAt: -1 })
      .lean();

    const formattedPictures = pictures.map((picture) => ({
      ...picture,

      shop: picture.uploadedBy
        ? {
          shopName: picture.uploadedBy.shopName || "",
          phoneNumber: picture.uploadedBy.phoneNumber || "",
          whatsappNumber: picture.uploadedBy.whatsappNumber || "",
          whatsappLink: picture.uploadedBy.whatsappLink || "",
        }
        : null,
    }));

    return res.status(200).json({
      success: true,
      count: formattedPictures.length,
      data: formattedPictures,
    });
  } catch (error) {
    console.error("Get Public Pictures Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch pictures.",
    });
  }
};


// GET /api/public/super-admin/price-differences
export const getSuperAdminPriceDifferences = async (req, res) => {
  try {
    const superAdmin = await SuperAdmin.findOne({
      isActive: true,
    }).select(
      'diff_24k diff_2385k diff_silver buy_diff_24k buy_diff_2385k buy_diff_silver'
    );

    if (!superAdmin) {
      return res.status(404).json({
        success: false,
        message: 'Active Super Admin not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        gold24k: {
          sellDifference: superAdmin.diff_24k,
          buyDifference: superAdmin.buy_diff_24k,
        },

        gold2385k: {
          sellDifference: superAdmin.diff_2385k,
          buyDifference: superAdmin.buy_diff_2385k,
        },

        silver: {
          sellDifference: superAdmin.diff_silver,
          buyDifference: superAdmin.buy_diff_silver,
        },
      },
    });
  } catch (error) {
    console.error(
      'Get Super Admin price differences error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Failed to get Super Admin price differences',
    });
  }
};