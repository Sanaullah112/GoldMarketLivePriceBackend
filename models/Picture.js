// ============================================================
// models/Picture.js
// ============================================================
import mongoose from 'mongoose';

const pictureSchema = new mongoose.Schema({
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'uploaderModel' },
  uploaderModel: { type: String, enum: ['Admin', 'SuperAdmin'], required: true },
  imageUrl: { type: String, required: true },
  cloudinaryPublicId: { type: String, required: true },
  title: { type: String, default: null, trim: true },
  description: { type: String, default: null },
  type: { type: String, enum: ['gold', 'silver', 'other'], default: 'gold' },
  weight: { type: Number, default: null },
  weightUnit: { type: String, enum: ['gram', 'tola'], default: 'gram' }, 
  price: { type: Number, default: null },

  // Visibility controls
  showOnHomePage: { type: Boolean, default: true },  // Visible to customers on home page
  showToAdmins: { type: Boolean, default: true },    // Visible to all shop admins
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const Picture = mongoose.model('Picture', pictureSchema);
export default Picture;