// ============================================================
// models/Notification.js
// ============================================================
import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "userModel",
    },
    userModel: {
      type: String,
      enum: ["Admin", "Customer", "SuperAdmin"],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
    type: String,
    enum: [
      'order', 
      'customer_registration', 
      'customer_flagged', 
      'customer_unflagged',  // ← ADD THIS LINE
      'customer_trusted', 
      'customer_untrusted', 
      'price_update'
    ],
    default: 'order'
  },
    isRead: { type: Boolean, default: false },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
