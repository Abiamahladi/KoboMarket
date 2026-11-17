const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/authenticate');
const authorizeRole = require('../../middleware/authorize-role');
const catalogueService = require('./catalogue.service');

const {
  productCreateSchema,
  productUpdateSchema,
  productQuerySchema
} = require('./catalogue.validation');

const validateBody = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.details.map((item) => item.message)
    });
  }

  req.validatedBody = value;
  next();
};

const validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, {
    abortEarly: false,
    convert: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      errors: error.details.map((item) => item.message)
    });
  }

  req.validatedQuery = value;
  next();
};

// Vendor: view own products
// Keep this route before /:productId.
router.get(
  '/vendor/mine',
  authenticate,
  authorizeRole('vendor'),
  async (req, res, next) => {
    try {
      const products = await catalogueService.getMyProducts(req.user.id);

      res.json({
        success: true,
        data: products
      });
    } catch (error) {
      next(error);
    }
  }
);

// Public: list products
router.get(
  '/',
  validateQuery(productQuerySchema),
  async (req, res, next) => {
    try {
      const result = await catalogueService.listProducts(
        req.validatedQuery
      );

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);

// Vendor: create product
router.post(
  '/',
  authenticate,
  authorizeRole('vendor'),
  validateBody(productCreateSchema),
  async (req, res, next) => {
    try {
      const product = await catalogueService.createProduct(
        req.user.id,
        req.validatedBody
      );

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: product
      });
    } catch (error) {
      next(error);
    }
  }
);

// Public: get one product
router.get('/:productId', async (req, res, next) => {
  try {
    const product = await catalogueService.getProduct(
      req.params.productId
    );

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    next(error);
  }
});

// Vendor: update own product
router.patch(
  '/:productId',
  authenticate,
  authorizeRole('vendor'),
  validateBody(productUpdateSchema),
  async (req, res, next) => {
    try {
      const product = await catalogueService.updateProduct(
        req.user.id,
        req.params.productId,
        req.validatedBody
      );

      res.json({
        success: true,
        message: 'Product updated successfully',
        data: product
      });
    } catch (error) {
      next(error);
    }
  }
);

// Vendor: archive own product
router.patch(
  '/:productId/archive',
  authenticate,
  authorizeRole('vendor'),
  async (req, res, next) => {
    try {
      const product = await catalogueService.archiveProduct(
        req.user.id,
        req.params.productId
      );

      res.json({
        success: true,
        message: 'Product archived successfully',
        data: product
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
