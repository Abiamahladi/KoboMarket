
const mongoose = require('mongoose');

const stockReservationSchema = new mongoose.Schema(
  {
    // Same reservation UUID used in PostgreSQL.
    reservationId: {
      type: String,
      required: true,
      unique: true,
      immutable: true
    },

    orderItemId: {
      type: String,
      required: true,
      immutable: true
    },

    productId: {
      type: String,
      required: true,
      immutable: true
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: 'Reservation quantity must be a whole number'
      }
    },

    status: {
      type: String,
      enum: ['reserved', 'committed', 'released'],
      required: true,
      default: 'reserved'
    },

    expiresAt: {
      type: Date,
      required: true
    },

    releasedAt: {
      type: Date,
      default: null
    },

    committedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

stockReservationSchema.index({ status: 1, expiresAt: 1 });
stockReservationSchema.index({ productId: 1, status: 1 });
stockReservationSchema.index({ orderItemId: 1 }, { unique: true });

module.exports = mongoose.model(
  'StockReservation',
  stockReservationSchema
);
