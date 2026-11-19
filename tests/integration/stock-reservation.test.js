/** @jest-environment node */
jest.setTimeout(30000);

const crypto = require('crypto');
const mongoose = require('mongoose');

const env = require('../../src/config/env');
const Product = require('../../src/modules/catalogue/product.model');
const StockReservation = require('../../src/modules/checkout/stock-reservation.model');

const {
  reserveStock,
  releaseStock,
  commitStock
} = require('../../src/modules/checkout/stock-reservation.service');

describe('Stock Reservation Service', () => {
  let productId;
  let testPrefix;

  const makeId = () => crypto.randomUUID();

  const getStock = async () => {
    const product = await Product.findOne({ productId });
    return product.stockQuantity;
  };

  beforeAll(async () => {
    console.log('TEST SETUP: Connecting to MongoDB');

    await mongoose.connect(env.MONGODB_URI, {
      directConnection: true,
      serverSelectionTimeoutMS: 5000
    });

    console.log('TEST SETUP: MongoDB connected');

    testPrefix = `jest-stock-${makeId()}`;
    productId = makeId();

    console.log('TEST SETUP: Creating temporary product');

    await Product.create({
      productId,
      vendorId: testPrefix,
      storeId: testPrefix,
      categoryId: testPrefix,
      name: 'Jest Stock Test Product',
      slug: testPrefix,
      description: 'Temporary product for stock reservation tests',
      priceKobo: 100000,
      currency: 'NGN',
      stockQuantity: 10,
      status: 'active'
    });
  });

  afterAll(async () => {
    try {
      await StockReservation.deleteMany({ productId });
      await Product.deleteOne({ productId });
    } finally {
      await mongoose.disconnect();
    }
  });

  test('reserves stock successfully', async () => {
    const reservation = await reserveStock({
      reservationId: makeId(),
      orderItemId: makeId(),
      productId,
      quantity: 2
    });

    expect(reservation.status).toBe('reserved');
    expect(await getStock()).toBe(8);
  });

  test('rejects insufficient stock without changing inventory', async () => {
    await expect(
      reserveStock({
        reservationId: makeId(),
        orderItemId: makeId(),
        productId,
        quantity: 100
      })
    ).rejects.toThrow('Product unavailable or insufficient stock');

    expect(await getStock()).toBe(8);
  });

  test('does not deduct stock twice for the same reservation', async () => {
    const request = {
      reservationId: makeId(),
      orderItemId: makeId(),
      productId,
      quantity: 2
    };

    const first = await reserveStock(request);
    const second = await reserveStock(request);

    expect(first.reservationId).toBe(second.reservationId);
    expect(await getStock()).toBe(6);
  });

  test('rejects a different reservation for the same order item', async () => {
    const orderItemId = makeId();

    await reserveStock({
      reservationId: makeId(),
      orderItemId,
      productId,
      quantity: 1
    });

    await expect(
      reserveStock({
        reservationId: makeId(),
        orderItemId,
        productId,
        quantity: 2
      })
    ).rejects.toThrow('Order item already has a different reservation');

    expect(await getStock()).toBe(5);
  });

  test('releases reserved stock without restoring it twice', async () => {
    const reservation = await reserveStock({
      reservationId: makeId(),
      orderItemId: makeId(),
      productId,
      quantity: 2
    });

    expect(await getStock()).toBe(3);

    const released = await releaseStock(reservation.reservationId);

    expect(released.status).toBe('released');
    expect(await getStock()).toBe(5);

    await releaseStock(reservation.reservationId);

    expect(await getStock()).toBe(5);
  });

  test('commits stock without deducting it again', async () => {
    const reservation = await reserveStock({
      reservationId: makeId(),
      orderItemId: makeId(),
      productId,
      quantity: 1
    });

    expect(await getStock()).toBe(4);

    const committed = await commitStock(reservation.reservationId);

    expect(committed.status).toBe('committed');
    expect(await getStock()).toBe(4);

    await commitStock(reservation.reservationId);

    expect(await getStock()).toBe(4);
  });

  test('does not release committed stock', async () => {
    const reservation = await reserveStock({
      reservationId: makeId(),
      orderItemId: makeId(),
      productId,
      quantity: 1
    });

    await commitStock(reservation.reservationId);

    await expect(
      releaseStock(reservation.reservationId)
    ).rejects.toThrow('Committed stock cannot be released');

    expect(await getStock()).toBe(3);
  });
});
