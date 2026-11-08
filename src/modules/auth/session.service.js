
const { redis } = require('../../config/redis');

const PREFIX = 'kobomarket:auth:refresh:';

const sessionService = {
  async createSession(tokenId, userId, expiresInSeconds) {
    const result = await redis.set(
      `${PREFIX}${tokenId}`,
      userId,
      'EX',
      expiresInSeconds,
      'NX'
    );

    return result === 'OK';
  },

  async isSessionActive(tokenId, userId) {
    const storedUserId = await redis.get(`${PREFIX}${tokenId}`);
    return storedUserId === userId;
  },

  async rotateSession(oldTokenId, newTokenId, userId, expiresInSeconds) {
    const script = `
      local oldUserId = redis.call('GET', KEYS[1])
      if oldUserId ~= ARGV[1] then return 0 end

      local created = redis.call(
        'SET', KEYS[2], ARGV[1], 'EX', ARGV[2], 'NX'
      )

      if not created then return 0 end

      redis.call('DEL', KEYS[1])
      return 1
    `;

    const result = await redis.eval(
      script,
      2,
      `${PREFIX}${oldTokenId}`,
      `${PREFIX}${newTokenId}`,
      userId,
      expiresInSeconds
    );

    return result === 1;
  },

  async revokeSession(tokenId) {
    return redis.del(`${PREFIX}${tokenId}`);
  },

  async revokeAllSessionsForUser(userId) {
    let cursor = '0';
    let revokedCount = 0;

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${PREFIX}*`,
        'COUNT',
        100
      );

      cursor = nextCursor;

      if (keys.length === 0) continue;

      const pipeline = redis.pipeline();

      keys.forEach((key) => pipeline.get(key));

      const results = await pipeline.exec();

      const userSessionKeys = keys.filter((key, index) => {
        const [error, storedUserId] = results[index];

        if (error) throw error;

        return storedUserId === userId;
      });

      if (userSessionKeys.length > 0) {
        revokedCount += await redis.del(...userSessionKeys);
      }
    } while (cursor !== '0');

    return revokedCount;
  }
};

module.exports = sessionService;
