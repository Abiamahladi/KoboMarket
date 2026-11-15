
const mongoose = require('mongoose');
const crypto = require('crypto');

const vendorSchema = new mongoose.Schema(
  {
    vendorId: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      immutable: true
    },
    userId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      index: true
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    businessDescription: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },
    businessEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    businessPhone: {
      type: String,
      required: true,
      trim: true
    },
    businessAddress: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
      index: true
    },
    reviewedBy: {
      type: String,
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    },
    rejectionReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

module.exports = mongoose.model('Vendor', vendorSchema);
