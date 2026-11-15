
const mongoose = require('mongoose');
const crypto = require('crypto');

const storeSchema = new mongoose.Schema(
  {
    storeId: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      immutable: true
    },
    vendorId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      index: true
    },
    storeName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1500
    },
    logo: {
      type: String,
      default: null
    },
    contactEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    contactPhone: {
      type: String,
      required: true,
      trim: true
    },
    address: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'closed'],
      default: 'active',
      index: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

module.exports = mongoose.model('Store', storeSchema);

