const { db } = require('../../config/postgres');

/**
 * Executes an order operation under a PostgreSQL
 * session-level advisory lock.
 *
 * Both reservation and recovery must use this helper.
 */
const withOrderLock = async (orderId, operation) => {
  if (!orderId) {
    throw new Error('Order ID is required');
  }

  if (typeof operation !== 'function') {
    throw new Error('Operation must be a function');
  }

  // Keep one PostgreSQL connection for the entire operation.
  const connection = await db.client.acquireConnection();

  let locked = false;

  try {
    // Derive a stable 64-bit lock key from the order UUID.
    // hashtextextended returns a PostgreSQL bigint.
    const result = await db
      .raw(
        'SELECT pg_advisory_lock(hashtextextended(?::text, 0))',
        [orderId]
      )
      .connection(connection);

    locked = true;

    return await operation();
  } finally {
    if (locked) {
      try {
        await db
          .raw(
            'SELECT pg_advisory_unlock(hashtextextended(?::text, 0))',
            [orderId]
          )
          .connection(connection);
      } finally {
        await db.client.releaseConnection(connection);
      }
    } else {
      await db.client.releaseConnection(connection);
    }
  }
};

module.exports = {
  withOrderLock
};
