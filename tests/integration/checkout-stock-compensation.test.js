/** @jest-environment node */

jest.setTimeout(60000);

const crypto = require('node:crypto');
const mongoose = require('mongoose');

const env = require('../../src/config/env');
const { db } = require('../../src/config/postgres');

const Product = require('../../src/modules/catalogue/product.model');
const StockReservation = require('../../src/modules/checkout/stock-reservation.model');

const {
  prepareCheckout
} = require('../../src/modules/checkout/checkout.service');

const {
  reserveOrderStock
} = require('../../src/modules/checkout/checkout-stock.coordinator');

const makeId = () => crypto.randomUUID();

describe('Checkout Stock Compensation', () => {
  let userId;
  let orderId;
  let productA;
  let productB;
  let testPrefix;

  const getStock = async (productId) => {
    const product = await Product.findOne({ productId });
    return product.stockQuantity;
  };

  beforeAll(async () => {
    await mongoose.connect(env.MONGODB_URI, {
      directConnection: true,
      serverSelectionTimeoutMS: 5000
    });

    const user = await db('users').select('id').first();

    if (!user) {
      throw new Error('An existing PostgreSQL user is required');
    }

    userId = user.id;
    testPrefix = `checkout-comp-${makeId()}`;

    productA = makeId();
    productB = makeId();

    await Product.create([
      {
        productId: productA,
        vendorId: makeId(),
        storeId: makeId(),
        categoryId: makeId(),
        name: 'Checkout Test Laptop',
        slug: `${testPrefix}-laptop`,
        description: 'Temporary checkout test product',
        priceKobo: 15000000,
        currency: 'NGN',
        stockQuantity: 10,
        status: 'active'
      },
      {
        productId: productB,
        vendorId: makeId(),
        storeId: makeId(),
        categoryId: makeId(),
        name: 'Checkout Test Mouse',
        slug: `${testPrefix}-mouse`,
        description: 'Temporary checkout test product',
        priceKobo: 500000,
        currency: 'NGN',
        stockQuantity: 0,
        status: 'active'
      }
    ]);
  });

  afterAll(async () => {
    try {
      if (orderId) {
        const reservations = await db('stock_reservations as sr')
          .join('order_items as oi', 'sr.order_item_id', 'oi.id')
          .join('vendor_orders as vo', 'oi.vendor_order_id', 'vo.id')
          .where('vo.order_id', orderId)
          .select('sr.id');

        // Remove only MongoDB records created by this test.
        await StockReservation.deleteMany({
          reservationId: {
            $in: reservations.map((row) => row.id)
          }
        });
      }

      await Product.deleteMany({
        productId: { $in: [productA, productB].filter(Boolean) }
      });
    } finally {
      await mongoose.disconnect();
      await db.destroy();
    }
  });

  test('restores stock when a later reservation fails', async () => {
    const products = await Product.find({
      productId: { $in: [productA, productB] }
    });

    const laptop = products.find((p) => p.productId === productA);
    const mouse = products.find((p) => p.productId === productB);

    const cart = {
      currency: 'NGN',
      hasUnavailableItems: false,
      items: [
        {
          productId: productA,
          vendorId: laptop.vendorId,
          name: laptop.name,
          priceKobo: laptop.priceKobo,
          currency: 'NGN',
          quantity: 2,
          available: true
        },
        {
          productId: productB,
          vendorId: mouse.vendorId,
          name: mouse.name,
          priceKobo: mouse.priceKobo,
          currency: 'NGN',
          quantity: 1,
          available: true
        }
      ]
    };

    const prepared = await prepareCheckout({
      userId,
      idempotencyKey: `comp-${makeId()}`,
      shippingAddress: '123 Test Street, Lagos, Nigeria',
      paymentMethod: 'wallet',
      cartOverride: cart
    });

    orderId = prepared.orderId;

    expect(prepared.claimed).toBe(true);
    expect(prepared.reservations).toHaveLength(2);

    await expect(
      reserveOrderStock(orderId)
    ).rejects.toMatchObject({
      statusCode: 409,
      stockReleased: true
    });

    expect(await getStock(productA)).toBe(10);
    expect(await getStock(productB)).toBe(0);

    const rows = await db('stock_reservations as sr')
      .join('order_items as oi', 'sr.order_item_id', 'oi.id')
      .join('vendor_orders as vo', 'oi.vendor_order_id', 'vo.id')
      .where('vo.order_id', orderId)
      .select('sr.status');

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.status).toBe('released');
    }

    console.log('PASS: Insufficient stock detected');
    console.log('PASS: Previously reserved stock restored');
    console.log('PASS: PostgreSQL reservation states reconciled');
  });
});
