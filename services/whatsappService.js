// services/whatsappService.js - No Twilio dependency
import { formatWhatsAppNumber, generateWhatsAppLink } from '../utils/whatsapp.js';

/**
 * Send WhatsApp message or generate link with shop's own number
 * For multi-shop system, each shop uses their own WhatsApp number
 */
export const sendWhatsAppFromShop = async (to, message, shopWhatsappNumber) => {
  if (!shopWhatsappNumber) {
    // No shop number provided - fall back to generic link
    return sendWhatsAppMessage(to, message);
  }
  
  // Create a direct link with the shop's WhatsApp number
  const formattedShopNumber = formatWhatsAppNumber(shopWhatsappNumber);
  const encodedMsg = encodeURIComponent(message);
  const link = `https://wa.me/${formattedShopNumber}?text=${encodedMsg}`;
  
  console.log(`WhatsApp link generated for shop number: ${formattedShopNumber}`);
  console.log(`Message: ${message.substring(0, 100)}...`);
  
  return { 
    success: false, 
    link, 
    message: 'Click the link to send message from your WhatsApp number.' 
  };
};

/**
 * Fallback method - generates link with customer's number
 */
export const sendWhatsAppMessage = async (to, message, shopWhatsappNumber = null) => {
  const formattedNumber = formatWhatsAppNumber(to);
  const encodedMsg = encodeURIComponent(message);
  const link = `https://wa.me/${formattedNumber}?text=${encodedMsg}`;
  
  return { 
    success: false, 
    link, 
    message: 'WhatsApp link generated. Click to send message.' 
  };
};