const crypto = require('crypto');
const { db } = require('../../config/postgres');

const createOrder = async ({
  userId,
  cart,
  shippingAddress,
  paymentMethod,
  transaction = null
}) => {
  if (!userId || !shippingAddress) {
    throw new Error('User ID and shipping address are required');
  }

  if (!['wallet', 'paystack'].includes(paymentMethod)) {
    throw new Error('Unsupported payment method');
  }

  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    throw new Error('Cannot create an order from an empty cart');
  }

  if (cart.hasUnavailableItems || cart.items.some((item) => !item.available)) {
    throw new Error('Cart contains unavailable products');
  }

  const groups = new Map();
  let subtotal = 0;

  for (const item of cart.items) {
    if (
      !item.productId ||
      !item.vendorId ||
      !item.name ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isSafeInteger(item.priceKobo) ||
      item.priceKobo < 0 ||
      item.currency !== 'NGN'
    ) {
      throw new Error('Cart contains invalid product information');
    }

    const lineTotal = item.priceKobo * item.quantity;

    if (!Number.isSafeInteger(lineTotal)) {
      throw new Error('Order amount exceeds the supported limit');
    }

    subtotal += lineTotal;

    if (!Number.isSafeInteger(subtotal)) {
      throw new Error('Order total exceeds the supported limit');
    }

    if (!groups.has(item.vendorId)) {
      groups.set(item.vendorId, []);
    }

    groups.get(item.vendorId).push({
      ...item,
      lineTotal
    });
  }

  const execute = async (trx) => {
    const orderId = crypto.randomUUID();
    const orderNumber = `KM-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

    await trx('orders').insert({
      id: orderId,
      order_number: orderNumber,
      user_id: userId,
      currency: 'NGN',
      status: 'pending',
      payment_method: paymentMethod,
      subtotal,
      shipping_fee: 0,
      discount_amount: 0,
      total_amount: subtotal,
      shipping_address: shippingAddress
    });

    const orderItems = [];

    for (const [vendorId, items] of groups) {
      const vendorOrderId = crypto.randomUUID();

      const vendorSubtotal = items.reduce(
        (total, item) => total + item.lineTotal,
        0
      );

      await trx('vendor_orders').insert({
        id: vendorOrderId,
        order_id: orderId,
        vendor_id: vendorId,
        status: 'pending',
        currency: 'NGN',
        subtotal: vendorSubtotal,
        shipping_fee: 0,
        total_amount: vendorSubtotal
      });

      for (const item of items) {
        const orderItemId = crypto.randomUUID();

        await trx('order_items').insert({
          id: orderItemId,
          vendor_order_id: vendorOrderId,
          product_id: item.productId,
          product_name: item.name,
          product_sku: null,
          quantity: item.quantity,
          unit_price: item.priceKobo,
          line_total: item.lineTotal
        });

        orderItems.push({
          orderItemId,
          vendorOrderId,
          productId: item.productId,
          vendorId,
          quantity: item.quantity,
          unitPriceKobo: item.priceKobo,
          lineTotalKobo: item.lineTotal
        });
      }
    }

    return {
      orderId,
      orderNumber,
      userId,
      status: 'pending',
      currency: 'NGN',
      subtotalKobo: subtotal,
      totalAmountKobo: subtotal,
      orderItems
    };
  };

  return transaction
    ? execute(transaction)
    : db.transaction(execute);
};

module.exports = {
  createOrder
};
