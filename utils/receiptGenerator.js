// ============================================================
// utils/receiptGenerator.js
// ============================================================
export const generateReceipt = (order, shop, customer) => {
  const carat = order.carat === '24k' ? '24 Karat' : '23.85 Karat';
  const date = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });

  return {
    receiptNumber: order.receiptNumber,
    date,
    shop: {
      name: shop.shopName,
      address: shop.address,
      phone: shop.phoneNumber,
    },
    customer: {
      name: customer.name,
      phone: customer.phoneNumber,
    },
    order: {
      type: order.orderType.toUpperCase(),
      metal: order.metalType.toUpperCase(),
      carat,
      quantity: order.quantity,
      unit: order.unit,
      quantityInTola: order.quantityInTola,
      quantityInGram: order.quantityInGram,
      pricePerTola: order.finalPricePerTolaPKR,
      totalAmount: order.finalizedAmount || order.totalAmount,
      paymentMethod: order.paymentMethod.toUpperCase(),
    },
    policy: 'Price confirmed at payment time per GoldChain policy. All transactions subject to final verification at shop.',
  };
};