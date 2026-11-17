
const mongoose = require('mongoose');
const crypto = require('crypto');

const categorySchema = new mongoose.Schema(
  {
    categoryId: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      immutable: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
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
      trim: true,
      maxlength: 500,
      default: ''
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true
    },
    createdBy: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

categorySchema.index({ status: 1, name: 1 });

module.exports = mongoose.model('Category', categorySchema);
