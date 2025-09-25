const cors = require('cors');

const corsOptions = {
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false, // Set to false when allowing all origins
  optionsSuccessStatus: 200 // For legacy browser support
};

const corsMiddleware = cors(corsOptions);

module.exports = {
  corsOptions,
  corsMiddleware
};
