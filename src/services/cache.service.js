const { redis } = require('../config/redis');

const PREFIX = 'kobomarket';
const DEFAULT_TTL = 300; // 5 minutes

const cacheService = {
  // Generate standard cache keys
  keys: {
    product: (id) => `${PREFIX}:products:item:${id}`,
    productList: (page = 1) => `${PREFIX}:products:list:page:${page}`,
    vendor: (id) => `${PREFIX}:vendors:profile:${id}`,
    store: (id) => `${PREFIX}:stores:details:${id}`,
    categories: () => `${PREFIX}:categories:all`
  },

  // Retrieve cached data
  async get(key) {
    try {
      const data = await redis.get(key);
      return data === null ? null : JSON.parse(data);
    } catch (error) {
      console.error('Cache GET failed:', error.message);
      return null;
    }
  },

  // Store data with expiration
  async set(key, value, ttl = DEFAULT_TTL) {
    try {
      const data = JSON.stringify(value);

      if (ttl > 0) {
        await redis.set(key, data, 'EX', ttl);
      } else {
        await redis.set(key, data);
      }

      return true;
    } catch (error) {
      console.error('Cache SET failed:', error.message);
      return false;
    }
  },

  // Delete a specific cache entry
  async del(key) {
    try {
      await redis.del(key);
      return true;
    } catch (error) {
      console.error('Cache DELETE failed:', error.message);
      return false;
    }
  },

  // Delete multiple cache entries matching a pattern
  async delByPattern(pattern) {
    try {
      let cursor = '0';
      let deletedCount = 0;

      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );

        cursor = nextCursor;

        if (keys.length > 0) {
          deletedCount += await redis.del(...keys);
        }
      } while (cursor !== '0');

      return deletedCount;
    } catch (error) {
      console.error('Cache pattern DELETE failed:', error.message);
      return 0;
    }
  },

  // Cache-aside pattern
  async remember(key, ttl, callback) {
    const cachedData = await this.get(key);

    if (cachedData !== null) {
      return cachedData;
    }

    const freshData = await callback();

    await this.set(key, freshData, ttl);

    return freshData;
  },

  // Invalidate product cache and product listings
  async invalidateProduct(productId) {
    await this.del(this.keys.product(productId));

    return this.delByPattern(`${PREFIX}:products:list:*`);
  },

  // Invalidate vendor cache
  async invalidateVendor(vendorId) {
    return this.del(this.keys.vendor(vendorId));
  },

  // Invalidate store cache
  async invalidateStore(storeId) {
    return this.del(this.keys.store(storeId));
  }
};

module.exports = cacheService;
