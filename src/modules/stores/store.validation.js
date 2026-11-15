
const Joi = require('joi');

const createStoreSchema = Joi.object({
  storeName: Joi.string().trim().min(2).max(120).required(),

  description: Joi.string().trim().min(10).max(1500).required(),

  logo: Joi.string().uri().allow('', null).optional(),

  contactEmail: Joi.string().trim().email().max(254).required(),

  contactPhone: Joi.string().trim().min(7).max(25).required(),

  address: Joi.string().trim().min(5).max(300).required()
});

const updateStoreSchema = Joi.object({
  storeName: Joi.string().trim().min(2).max(120),

  description: Joi.string().trim().min(10).max(1500),

  logo: Joi.string().uri().allow('', null),

  contactEmail: Joi.string().trim().email().max(254),

  contactPhone: Joi.string().trim().min(7).max(25),

  address: Joi.string().trim().min(5).max(300)
}).min(1);

const validateCreateStore = (req, res, next) => {
  const { error, value } = createStoreSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid store details',
      errors: error.details.map((detail) => detail.message)
    });
  }

  req.body = value;
  next();
};

const validateUpdateStore = (req, res, next) => {
  const { error, value } = updateStoreSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid store update details',
      errors: error.details.map((detail) => detail.message)
    });
  }

  req.body = value;
  next();
};

module.exports = {
  validateCreateStore,
  validateUpdateStore
};
