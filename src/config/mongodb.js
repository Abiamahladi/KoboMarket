
const mongoose = require('mongoose');
const env = require('./env');

const connectMongoDB = async () => {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      directConnection: true
    });

    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    throw error;
  }
};

module.exports = connectMongoDB;
