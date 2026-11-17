const { redis } = require('../../config/redis');
const Product = require('../catalogue/product.model');

const CART_TTL = 7 * 24 * 60 * 60; // 7 days

const cartKey = (userId) => `kobomarket:cart:${userId}`;

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// Atomically add quantity, checking the current cart quantity against stock.
const ADD_ITEM_SCRIPT = `
  local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
  local quantity = tonumber(ARGV[2])
  local stock = tonumber(ARGV[3])

  if current + quantity > stock then
    return -1
  end

  local updated = redis.call('HINCRBY', KEYS[1], ARGV[1], quantity)
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))

  return updated
`;

// Atomically update quantity and check available stock.
const UPDATE_ITEM_SCRIPT = `
  local quantity = tonumber(ARGV[2])
  local stock = tonumber(ARGV[3])

  if quantity > stock then
    return -1
  end

  redis.call('HSET', KEYS[1], ARGV[1], quantity)
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))

  return quantity
`;

const cartService = {
  async addItem(userId, productId, quantity) {
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw createError('Quantity must be a positive whole number');
    }

    const product = await Product.findOne({
      productId,
      status: 'active'
    }).select(
      'productId name priceKobo currency stockQuantity images vendorId storeId'
    ).lean();

    if (!product) {
      throw createError('Product not found or unavailable', 404);
    }

    if (product.stockQuantity < 1) {
      throw createError('Product is out of stock');
    }

    const result = await redis.eval(
      ADD_ITEM_SCRIPT,
      1,
      cartKey(userId),
      productId,
      quantity,
      product.stockQuantity,
      CART_TTL
    );

    if (Number(result) === -1) {
      throw createError('Requested quantity exceeds available stock');
    }

    return this.getCart(userId);
  },

  async getCart(userId) {
    const key = cartKey(userId);
    const storedItems = await redis.hgetall(key);

    const productIds = Object.keys(storedItems);

    if (productIds.length === 0) {
      return {
        items: [],
        itemCount: 0,
        subtotalKobo: 0,
        currency: 'NGN'
      };
    }

    const products = await Product.find({
      productId: { $in: productIds }
    }).select(
      'productId name priceKobo currency stockQuantity images status vendorId storeId'
    ).lean();

    const productMap = new Map(
      products.map((product) => [product.productId, product])
    );

    const items = productIds.map((productId) => {
      const product = productMap.get(productId);
      const quantity = Number(storedItems[productId]);

      if (!product || product.status !== 'active') {
        return {
          productId,
          quantity,
          available: false,
          message: 'Product is no longer available',
          lineTotalKobo: 0
        };
      }

      const available = product.stockQuantity >= quantity;

      return {
        productId: product.productId,
        name: product.name,
        priceKobo: product.priceKobo,
        currency: product.currency,
        quantity,
        stockQuantity: product.stockQuantity,
        available,
        message: available
          ? null
          : 'Requested quantity exceeds current stock',
        images: product.images,
        vendorId: product.vendorId,
        storeId: product.storeId,
        lineTotalKobo: product.priceKobo * quantity
      };
    });

    const validItems = items.filter((item) => item.available);

    const subtotalKobo = validItems.reduce(
      (total, item) => total + item.lineTotalKobo,
      0
    );

    const itemCount = items.reduce(
      (total, item) => total + item.quantity,
      0
    );

    return {
      items,
      itemCount,
      subtotalKobo,
      currency: 'NGN',
      hasUnavailableItems: items.some((item) => !item.available)
    };
  },

  async updateItem(userId, productId, quantity) {
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw createError('Quantity must be a positive whole number');
    }

    const key = cartKey(userId);
    const exists = await redis.hexists(key, productId);

    if (!exists) {
      throw createError('Product is not in your cart', 404);
    }

    const product = await Product.findOne({
      productId,
      status: 'active'
    }).select('productId stockQuantity').lean();

    if (!product) {
      throw createError('Product is no longer available', 404);
    }

    const result = await redis.eval(
      UPDATE_ITEM_SCRIPT,
      1,
      key,
      productId,
      quantity,
      product.stockQuantity,
      CART_TTL
    );

    if (Number(result) === -1) {
      throw createError('Requested quantity exceeds available stock');
    }

    return this.getCart(userId);
  },

  async removeItem(userId, productId) {
    const result = await redis.hdel(cartKey(userId), productId);

    if (result === 0) {
      throw createError('Product is not in your cart', 404);
    }

    return this.getCart(userId);
  },

  async clearCart(userId) {
    await redis.del(cartKey(userId));

    return {
      items: [],
      itemCount: 0,
      subtotalKobo: 0,
      currency: 'NGN'
    };
  }
};

module.exports = cartService;
