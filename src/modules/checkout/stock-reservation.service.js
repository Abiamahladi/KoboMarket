const crypto = require('crypto');
const mongoose = require('mongoose');

const Product = require('../catalogue/product.model');
const StockReservation = require('./stock-reservation.model');

const DEFAULT_RESERVATION_MINUTES = 30;

const validateId = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`);
  }
};

const validateQuantity = (quantity) => {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive whole number');
  }
};

const reserveStock = async ({
  reservationId = crypto.randomUUID(),
  orderItemId,
  productId,
  quantity,
  expiresAt = new Date(
    Date.now() + DEFAULT_RESERVATION_MINUTES * 60 * 1000
  )
}) => {
  validateId(reservationId, 'Reservation ID');
  validateId(orderItemId, 'Order item ID');
  validateId(productId, 'Product ID');
  validateQuantity(quantity);

  if (!(expiresAt instanceof Date) ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt <= new Date()) {
    throw new Error('Reservation expiry must be a future date');
  }

  const existing = await StockReservation.findOne({ orderItemId });

  if (existing) {
    if (
      existing.reservationId === reservationId &&
      existing.productId === productId &&
      existing.quantity === quantity
    ) {
      if (
        existing.status !== 'reserved' ||
        existing.expiresAt <= new Date()
      ) {
        throw new Error('Stock reservation is no longer active');
      }

      return existing;
    }

    throw new Error('Order item already has a different reservation');
  }

  const session = await mongoose.startSession();

  try {
    let reservation;

    await session.withTransaction(async () => {
      // Recheck inside the transaction to prevent duplicate deductions.
      const duplicate = await StockReservation
        .findOne({ orderItemId })
        .session(session);

      if (duplicate) {
        if (
          duplicate.reservationId === reservationId &&
          duplicate.productId === productId &&
          duplicate.quantity === quantity
        ) {
          if (
            duplicate.status !== 'reserved' ||
            duplicate.expiresAt <= new Date()
          ) {
            throw new Error('Stock reservation is no longer active');
          }

          reservation = duplicate;
          return;
        }

        throw new Error('Order item already has a different reservation');
      }

      // The conditional update prevents stock from becoming negative.
      const product = await Product.findOneAndUpdate(
        {
          productId,
          status: 'active',
          stockQuantity: { $gte: quantity }
        },
        {
          $inc: { stockQuantity: -quantity }
        },
        {
          returnDocument: 'after',
          session
        }
      );

      if (!product) {
        const error = new Error(
          'Product unavailable or insufficient stock'
        );
        error.code = 'INSUFFICIENT_STOCK';
        error.definiteFailure = true;
        throw error;
      }

      const [created] = await StockReservation.create(
        [{
          reservationId,
          orderItemId,
          productId,
          quantity,
          status: 'reserved',
          expiresAt
        }],
        { session }
      );

      reservation = created;
    });

    return reservation;
  } catch (error) {
    // A competing request may have committed the same reservation.
    // Never deduct stock again when resolving that conflict.
    if (error.code === 11000) {
      const existingReservation = await StockReservation.findOne({
        orderItemId
      });

      if (
        existingReservation &&
        existingReservation.reservationId === reservationId &&
        existingReservation.productId === productId &&
        existingReservation.quantity === quantity
      ) {
        if (
          existingReservation.status !== 'reserved' ||
          existingReservation.expiresAt <= new Date()
        ) {
          throw new Error('Stock reservation is no longer active');
        }

        return existingReservation;
      }

      throw new Error('Duplicate stock reservation');
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const releaseStock = async (reservationId) => {
  validateId(reservationId, 'Reservation ID');

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const reservation = await StockReservation
        .findOne({ reservationId })
        .session(session);

      if (!reservation) {
        throw new Error('Stock reservation not found');
      }

      if (reservation.status === 'released') {
        result = reservation;
        return;
      }

      if (reservation.status === 'committed') {
        throw new Error('Committed stock cannot be released');
      }

      const product = await Product.findOneAndUpdate(
        { productId: reservation.productId },
        { $inc: { stockQuantity: reservation.quantity } },
        { returnDocument: 'after', session }
      );

      if (!product) {
        throw new Error('Product not found while releasing stock');
      }

      reservation.status = 'released';
      reservation.releasedAt = new Date();

      await reservation.save({ session });

      result = reservation;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

const commitStock = async (reservationId) => {
  validateId(reservationId, 'Reservation ID');

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const reservation = await StockReservation
        .findOne({ reservationId })
        .session(session);

      if (!reservation) {
        throw new Error('Stock reservation not found');
      }

      if (reservation.status === 'committed') {
        result = reservation;
        return;
      }

      if (reservation.status === 'released') {
        throw new Error('Released stock cannot be committed');
      }

      reservation.status = 'committed';
      reservation.committedAt = new Date();

      await reservation.save({ session });

      result = reservation;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  reserveStock,
  releaseStock,
  commitStock
};
