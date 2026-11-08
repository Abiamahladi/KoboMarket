
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

  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .required(),

  JWT_REFRESH_EXPIRES_IN: Joi.string()
    .default('7d'),

  // Email / SMTP Configuration
  SMTP_HOST: Joi.string()
    .allow('')
    .default(''),

  SMTP_PORT: Joi.number()
    .port()
    .default(587),

  SMTP_SECURE: Joi.boolean()
    .default(false),

  SMTP_USER: Joi.string()
    .allow('')
    .default(''),

  SMTP_PASS: Joi.string()
    .allow('')
    .default(''),

  EMAIL_FROM: Joi.string()
    .allow('')
    .default(''),

  PASSWORD_RESET_URL: Joi.string()
    .uri()
    .default('http://localhost:3000/reset-password'),

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
