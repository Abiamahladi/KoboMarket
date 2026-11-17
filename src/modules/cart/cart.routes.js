const express = require('express');

const authenticate = require('../../middleware/authenticate');
const authorizeRole = require('../../middleware/authorize-role');

const cartController = require('./cart.controller');

const {
  validateAddItem,
  validateUpdateItem
} = require('./cart.validation');

const router = express.Router();

// All cart endpoints require an authenticated customer.
router.use(authenticate);
router.use(authorizeRole('customer'));

// Retrieve the customer's cart.
router.get('/', cartController.getCart);

// Add a product.
router.post('/items', validateAddItem, cartController.addItem);

// Update a product quantity.
router.patch('/items/:productId', validateUpdateItem, cartController.updateItem);

// Remove a product.
router.delete('/items/:productId', cartController.removeItem);

// Clear the cart.
router.delete('/', cartController.clearCart);

module.exports = router;
