
const Joi = require('joi');

// Validate the information submitted during checkout.
const checkoutSchema = Joi.object({
  paymentMethod: Joi.string()
    .valid('wallet', 'paystack')
    .required(),

  shippingAddress: Joi.string()
    .trim()
    .min(10)
    .max(1000)
    .required()
});

// Validate checkout requests before they reach the controller.
const validateCheckout = (req, res, next) => {
  const { error, value } = checkoutSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details
        .map((detail) => detail.message)
        .join('; ')
    });
  }

  const idempotencyKey = req.get('Idempotency-Key');

  if (
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.trim().length < 8 ||
    idempotencyKey.length > 150
  ) {
    return res.status(400).json({
      success: false,
      message: 'A valid Idempotency-Key header (8–150 characters) is required'
    });
  }

  req.body = value;
  req.checkoutIdempotencyKey = idempotencyKey.trim();

  next();
};

module.exports = {
  validateCheckout
};
