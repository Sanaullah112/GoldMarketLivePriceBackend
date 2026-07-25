// utils/whatsapp.js
export const formatWhatsAppNumber = (phone) => {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '92' + digits.slice(1);
  if (digits.startsWith('92')) return digits;
  return '92' + digits;
};

export const generateWhatsAppLink = (phone, message) => {
  const number = formatWhatsAppNumber(phone);
  const encodedMsg = encodeURIComponent(message);
  return `https://wa.me/${number}?text=${encodedMsg}`;
};

// Templates with shop name parameter
export const whatsAppTemplates = {
  // Registration approved
  registrationApproved: (customerName, shopName) =>
    `🎉 *${shopName} - Registration Approved* 🎉\n\nDear ${customerName},\n\nYour registration with *${shopName}* has been APPROVED! ✅\n\n✨ What you can do now:\n• View live gold & silver prices\n• Place buy/sell orders\n• Get real-time rate updates\n• Contact shop directly\n\nThank you for choosing ${shopName}! 🌟\n\n_This is an automated message._`,

  // Registration rejected
  registrationRejected: (customerName, shopName, reason) =>
    `📋 *${shopName} - Registration Update* 📋\n\nDear ${customerName},\n\nThank you for your interest in ${shopName}.\n\nUnfortunately, your registration request has been DECLINED. ❌\n\nReason: ${reason || 'Please contact the shop for more details.'}\n\nFor any questions, please reach out to ${shopName} directly.\n\n_This is an automated message._`,

  // Trusted status granted
  trustedGranted: (customerName, shopName) =>
    `⭐ *${shopName} - Trusted Customer Status* ⭐\n\nDear ${customerName},\n\nCongratulations! 🎉\n\n*${shopName}* has marked you as a TRUSTED CUSTOMER! 🛡️\n\n✨ Thank you for your continued trust in ${shopName}! 🙏\n\n_This is an automated message._`,

  // Trusted status removed
  trustedRemoved: (customerName, shopName) =>
    `📋 *${shopName} - Account Update* 📋\n\nDear ${customerName},\n\nYour TRUSTED CUSTOMER status has been REMOVED by ${shopName}. 🔄\n\n⚠️ What this means:\n• Orders will now require manual approval\n\n For more information, please contact ${shopName} directly.\n\n_This is an automated message._`,

  // Flagged as scam
  flaggedAsScam: (customerName, shopName, reason) =>
    `🚫 *${shopName} - Account Restricted* 🚫\n\nDear ${customerName},\n\nYour account has been FLAGGED by ${shopName} as potential scam activity. ⚠️\n\nReason: ${reason || 'Suspicious activity detected'}\n\n🔒 What this means:\n• You CANNOT place new orders with ${shopName}\n• Existing orders may be reviewed\n\nIf you believe this is a mistake, please contact ${shopName} directly to resolve this matter.\n\n_This is an automated message._`,

  // Flag removed
  flagRemoved: (customerName, shopName) =>
    `✅ *${shopName} - Account Restored* ✅\n\nDear ${customerName},\n\nGreat news! 🎉\n\n*${shopName}* has REMOVED the flag from your account.\n\n✨ Your account is now:\n• Fully active\n• Able to place orders\n• Back to normal status\n\nThank you for your cooperation! 🙏\n\n_This is an automated message._`,

  // Order approved
  orderApproved: (customerName, shopName, orderDetails) =>
    `✅ *${shopName} - Order Approved* ✅\n\nDear ${customerName},\n\nYour order has been APPROVED! 🎉\n\n📋 *Order Details:*\n• Type: ${orderDetails.orderType.toUpperCase()}\n• Metal: ${orderDetails.metalType}${orderDetails.carat ? ` (${orderDetails.carat})` : ''}\n• Quantity: ${orderDetails.quantity} ${orderDetails.unit}\n• Total Amount: PKR ${orderDetails.totalAmount.toLocaleString()}\n\n📞 Please visit our shop or contact us to complete payment.\n\nThank you for choosing ${shopName}! 🌟\n\n_This is an automated message._`,

  // Order rejected
  orderRejected: (customerName, shopName, reason) =>
    `❌ *${shopName} - Order Update* ❌\n\nDear ${customerName},\n\nWe regret to inform you that your order has been REJECTED. 📋\n\nReason: ${reason || 'Please contact the shop for details.'}\n\nFor more information, please reach out to ${shopName} directly.\n\n_This is an automated message._`,

  // Order completed
  orderCompleted: (customerName, shopName, receiptNumber, totalAmount) =>
    `✅ *${shopName} - Transaction Complete* ✅\n\nDear ${customerName},\n\nYour transaction has been COMPLETED successfully! 🎉\n\n🧾 Receipt No: ${receiptNumber}\n💰 Total Amount: PKR ${totalAmount.toLocaleString()}\n\nThank you for choosing ${shopName}! 🌟\n\nFor any queries, please contact the shop.\n\n_This is an automated message._`,

  // New order notification for admin (sent via SMS/notification)
  newOrderNotification: (shopName, customerName, orderType, quantity, unit, metalType, totalAmount) =>
    `🔔 *New Order - ${shopName}* 🔔\n\nA new order has arrived!\n\n👤 Customer: ${customerName}\n📋 Type: ${orderType.toUpperCase()}\n⚖️ Qty: ${quantity} ${unit} ${metalType}\n💰 Total: PKR ${totalAmount.toLocaleString()}\n\nPlease review and approve.`,
};