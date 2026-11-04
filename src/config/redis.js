const Redis = require('ioredis');
const env = require('./env');

const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 500, 5000);
  }
});

redis.on('connect', () => {
  console.log('Redis connected successfully');
});

redis.on('error', (error) => {
  console.error('Redis connection error:', error.message);
});

const connectRedis = async () => {
  try {
    await redis.ping();
  } catch (error) {
    console.error('Redis connection failed:', error.message);
    throw error;
  }
};

module.exports = { redis, connectRedis };
