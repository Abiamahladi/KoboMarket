const Joi = require('joi');

const categoryCreateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().max(500).allow('').default('')
});

const categoryUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  description: Joi.string().trim().max(500).allow(''),
  status: Joi.string().valid('active', 'inactive')
}).min(1);

const productCreateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(160).required(),
  description: Joi.string().trim().min(10).max(5000).required(),
  categoryId: Joi.string().uuid().required(),

  priceKobo: Joi.number()
    .integer()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .required(),

  stockQuantity: Joi.number()
    .integer()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .default(0),

  sku: Joi.string().trim().uppercase().max(100).allow('', null),

  images: Joi.array()
    .items(Joi.string().uri())
    .max(10)
    .default([]),

  tags: Joi.array()
    .items(Joi.string().trim().min(1).max(40))
    .max(20)
    .default([]),

  status: Joi.string()
    .valid('draft', 'active')
    .default('draft')
});

const productUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(160),
  description: Joi.string().trim().min(10).max(5000),
  categoryId: Joi.string().uuid(),

  priceKobo: Joi.number()
    .integer()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),

  stockQuantity: Joi.number()
    .integer()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER),

  sku: Joi.string().trim().uppercase().max(100).allow('', null),

  images: Joi.array()
    .items(Joi.string().uri())
    .max(10),

  tags: Joi.array()
    .items(Joi.string().trim().min(1).max(40))
    .max(20),

  status: Joi.string().valid('draft', 'active')
}).min(1);

const productQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  categoryId: Joi.string().uuid(),
  vendorId: Joi.string().uuid(),
  search: Joi.string().trim().max(100),
  sort: Joi.string()
    .valid('newest', 'price_asc', 'price_desc', 'rating')
    .default('newest')
});

module.exports = {
  categoryCreateSchema,
  categoryUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
  productQuerySchema
};
