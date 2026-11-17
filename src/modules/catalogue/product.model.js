
const mongoose = require('mongoose');
const crypto = require('crypto');

const productSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      immutable: true
    },
    vendorId: {
      type: String,
      required: true,
      immutable: true,
      index: true
    },
    storeId: {
      type: String,
      required: true,
      immutable: true,
      index: true
    },
    categoryId: {
      type: String,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000
    },
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      maxlength: 100
    },
    priceKobo: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: 'Product price must be a safe integer in kobo'
      }
    },
    currency: {
      type: String,
      required: true,
      default: 'NGN',
      uppercase: true,
      match: /^[A-Z]{3}$/
    },
    stockQuantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: 'Stock quantity must be a whole number'
      }
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (images) => images.length <= 10,
        message: 'A product can have at most 10 images'
      }
    },
    tags: {
      type: [String],
      default: []
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      default: 'draft',
      index: true
    },
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    reviewCount: {
      type: Number,
      default: 0,
      min: 0
    },
    totalSold: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

productSchema.index({ storeId: 1, slug: 1 }, { unique: true });
productSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
productSchema.index({ categoryId: 1, status: 1, createdAt: -1 });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Product', productSchema);
