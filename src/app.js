
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');

const authRoutes = require('./modules/auth/auth.routes');
const userRoutes = require('./modules/users/user.routes');
const adminRoutes = require('./modules/authorization/admin.routes');
const vendorRoutes = require('./modules/vendors/vendor.routes');
const vendorAdminRoutes = require('./modules/vendors/vendor.admin.routes');
const storeRoutes = require('./modules/stores/store.routes');
const productRoutes = require('./modules/catalogue/product.routes');
const categoryRoutes = require('./modules/catalogue/category.routes');
const cartRoutes = require('./modules/cart/cart.routes');
const walletRoutes = require('./modules/wallets/wallet.routes');
const paymentRoutes = require('./modules/payments/payment.routes');

const app = express();

app.use(helmet());
app.use(cors());

app.use(pinoHttp());

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'KoboMarket API is running',
    timestamp: new Date().toISOString()
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/admin/vendors', vendorAdminRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/payments', paymentRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Central error handler
app.use((error, req, res, next) => {
  if (req.log) {
    req.log.error(error);
  } else {
    console.error(error);
  }

  if (
    error instanceof SyntaxError &&
    error.status === 400 &&
    'body' in error
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON request body'
    });
  }

  const statusCode = error.statusCode || 500;

  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500
      ? 'Internal server error'
      : error.message
  });
});

module.exports = app;
