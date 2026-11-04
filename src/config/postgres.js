const knex = require('knex');
const env = require('./env');

const db = knex({
  client: 'pg',
  connection: {
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD
  },
  pool: {
    min: 0,
    max: 5
  }
});

const connectPostgres = async () => {
  try {
    await db.raw('SELECT 1');
    console.log('PostgreSQL connected successfully');
  } catch (error) {
    console.error('PostgreSQL connection failed:', error.message);
    throw error;
  }
};

module.exports = { db, connectPostgres };
