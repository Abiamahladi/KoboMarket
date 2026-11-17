const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/authenticate');
const authorizePermission = require('../../middleware/authorize-permission');
const catalogueService = require('./catalogue.service');

const {
  categoryCreateSchema,
  categoryUpdateSchema
} = require('./catalogue.validation');

const validate = (schema) => (req, res, next) => {
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

// Public: list active categories
router.get('/', async (req, res, next) => {
  try {
    const categories = await catalogueService.listCategories();

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    next(error);
  }
});

// Admin: create category
router.post(
  '/',
  authenticate,
  authorizePermission('platform:manage'),
  validate(categoryCreateSchema),
  async (req, res, next) => {
    try {
      const category = await catalogueService.createCategory(
        req.validatedBody,
        req.user.id
      );

      res.status(201).json({
        success: true,
        message: 'Category created successfully',
        data: category
      });
    } catch (error) {
      next(error);
    }
  }
);

// Admin: update category
router.patch(
  '/:categoryId',
  authenticate,
  authorizePermission('platform:manage'),
  validate(categoryUpdateSchema),
  async (req, res, next) => {
    try {
      const category = await catalogueService.updateCategory(
        req.params.categoryId,
        req.validatedBody
      );

      res.json({
        success: true,
        message: 'Category updated successfully',
        data: category
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
