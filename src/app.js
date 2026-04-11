require('dotenv').config();
const express = require('express');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const propertyRoutes = require('./routes/propertyRoutes');
const roomRoutes = require('./routes/roomRoutes');
const tenantRoutes = require('./routes/tenantRoutes');
const rentRoutes = require('./routes/rentRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const reportRoutes = require('./routes/reportRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const searchRoutes      = require('./routes/searchRoutes');
const accountingRoutes  = require('./routes/accountingRoutes');
const { startReservationCron }       = require('./services/reservationCron');
const { startRecurringExpenseCron }  = require('./services/recurringExpenseCron');

connectDB();

// Start background jobs
startReservationCron();
startRecurringExpenseCron();

const rateLimit = require('express-rate-limit');

const app = express();

app.use(express.json());

// Rate limiting — skipped in development, enforced in production only
if (process.env.NODE_ENV === 'production') {
  // Auth routes: strict (20 attempts per 15 min) to prevent brute-force
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.' },
  });

  // General API routes: permissive (500 per 15 min) — a typical session uses ~10–30 req/page
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.' },
  });

  app.use('/api/auth', authLimiter);
  app.use('/api', apiLimiter);
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/properties/:propertyId/rooms', roomRoutes);
app.use('/api/properties/:propertyId/tenants', tenantRoutes);
app.use('/api/properties/:propertyId/rents', rentRoutes);
app.use('/api/properties/:propertyId/expenses', expenseRoutes);
app.use('/api/properties/:propertyId/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/search',   searchRoutes);
app.use('/api/properties/:propertyId/accounting', accountingRoutes);

// 404
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// Global error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
