
const Joi = require('joi');

const applicationSchema = Joi.object({
  businessName: Joi.string().trim().min(2).max(120).required(),

  businessDescription: Joi.string().trim().min(10).max(1000).required(),

  businessEmail: Joi.string().trim().email().max(254).required(),

  businessPhone: Joi.string().trim().min(7).max(25).required(),

  businessAddress: Joi.string().trim().min(5).max(300).required()
});

const rejectionSchema = Joi.object({
  reason: Joi.string().trim().min(5).max(500).required()
});

const validateApplication = (req, res, next) => {
  const { error, value } = applicationSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid vendor application details',
      errors: error.details.map((detail) => detail.message)
    });
  }

  req.body = value;
  next();
};

const validateRejection = (req, res, next) => {
  const { error, value } = rejectionSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'A valid rejection reason is required',
      errors: error.details.map((detail) => detail.message)
    });
  }

  req.body = value;
  next();
};

module.exports = {
  validateApplication,
  validateRejection
};
