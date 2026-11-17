const Joi = require('joi');

const addItemSchema = Joi.object({
  productId: Joi.string().guid({ version: 'uuidv4' }).required(),
  quantity: Joi.number().integer().min(1).max(100).required()
});

const updateItemSchema = Joi.object({
  quantity: Joi.number().integer().min(1).max(100).required()
});

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details.map((detail) => detail.message).join('; ')
    });
  }

  req.body = value;
  next();
};

module.exports = {
  validateAddItem: validate(addItemSchema),
  validateUpdateItem: validate(updateItemSchema)
};
