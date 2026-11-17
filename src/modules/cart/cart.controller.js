const cartService = require('./cart.service');

const cartController = {
  async addItem(req, res, next) {
    try {
      const cart = await cartService.addItem(
        req.user.id,
        req.body.productId,
        req.body.quantity
      );

      return res.status(200).json({
        success: true,
        message: 'Product added to cart',
        data: cart
      });
    } catch (error) {
      next(error);
    }
  },

  async getCart(req, res, next) {
    try {
      const cart = await cartService.getCart(req.user.id);

      return res.status(200).json({
        success: true,
        data: cart
      });
    } catch (error) {
      next(error);
    }
  },

  async updateItem(req, res, next) {
    try {
      const cart = await cartService.updateItem(
        req.user.id,
        req.params.productId,
        req.body.quantity
      );

      return res.status(200).json({
        success: true,
        message: 'Cart quantity updated',
        data: cart
      });
    } catch (error) {
      next(error);
    }
  },

  async removeItem(req, res, next) {
    try {
      const cart = await cartService.removeItem(
        req.user.id,
        req.params.productId
      );

      return res.status(200).json({
        success: true,
        message: 'Product removed from cart',
        data: cart
      });
    } catch (error) {
      next(error);
    }
  },

  async clearCart(req, res, next) {
    try {
      const cart = await cartService.clearCart(req.user.id);

      return res.status(200).json({
        success: true,
        message: 'Cart cleared successfully',
        data: cart
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = cartController;
