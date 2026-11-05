require('dotenv').config();

const sharedConfig = {
  client: 'pg',

  connection: {
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD
  },

  pool: {
    min: 0,
    max: 5
  },

  migrations: {
    directory: './database/migrations',
    tableName: 'knex_migrations',
    extension: 'js'
  },

  seeds: {
    directory: './database/seeds',
    extension: 'js'
  }
};

module.exports = {
  development: sharedConfig,
  production: sharedConfig,
  test: sharedConfig
};
