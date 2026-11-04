require('dotenv').config();

const Joi = require('joi');

const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number()
    .default(3000),

  APP_NAME: Joi.string()
    .default('KoboMarket'),

  MONGODB_URI: Joi.string()
    .required(),

  POSTGRES_HOST: Joi.string()
    .required(),

  POSTGRES_PORT: Joi.number()
    .default(5432),

  POSTGRES_DB: Joi.string()
    .required(),

  POSTGRES_USER: Joi.string()
    .required(),

  POSTGRES_PASSWORD: Joi.string()
    .required(),

  REDIS_HOST: Joi.string()
    .required(),

  REDIS_PORT: Joi.number()
    .default(6379),

  REDIS_PASSWORD: Joi.string()
    .required(),

  JWT_SECRET: Joi.string()
    .min(32)
    .required(),

  JWT_EXPIRES_IN: Joi.string()
    .default('1h'),

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('debug')
}).unknown(true);

const { error, value: env } = envSchema.validate(process.env, {
  abortEarly: false
});

if (error) {
  throw new Error(`Environment validation failed:\n${error.message}`);
}

module.exports = env;
