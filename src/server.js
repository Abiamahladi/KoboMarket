const app = require('./app');
const env = require('./config/env');

const connectMongoDB = require('./config/mongodb');
const { connectPostgres, db } = require('./config/postgres');
const { connectRedis, redis } = require('./config/redis');

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectMongoDB();

    // Connect to PostgreSQL
    await connectPostgres();

    // Connect to Redis
    await connectRedis();

    // Start Express server
    const server = app.listen(env.PORT, () => {
      console.log(`${env.APP_NAME} running on port ${env.PORT}`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`${signal} received. Shutting down...`);

      server.close(async () => {
        try {
          await Promise.all([
            db.destroy(),
            redis.quit()
          ]);

          const mongoose = require('mongoose');
          await mongoose.disconnect();

          console.log('All connections closed successfully');
          process.exit(0);
        } catch (error) {
          console.error('Shutdown error:', error.message);
          process.exit(1);
        }
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    console.error('Application startup failed:', error.message);
    process.exit(1);
  }
};

startServer();
