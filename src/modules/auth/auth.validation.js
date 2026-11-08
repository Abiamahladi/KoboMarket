const Joi = require('joi');

const registerSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(50).required(),
  lastName: Joi.string().trim().min(2).max(50).required(),
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().min(8).max(128).required()
});

const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().required()
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required()
});

const passwordResetRequestSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required()
});

const passwordResetSchema = Joi.object({
  token: Joi.string().hex().length(64).required(),
  newPassword: Joi.string().min(8).max(128).required()
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  passwordResetRequestSchema,
  passwordResetSchema
};
