const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { sendSignupAlert, sendWelcomeEmail } = require('../services/emailService');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;
  await User.create({ name, email, password, phone });

  // Non-blocking — failure must not break signup
  sendSignupAlert({ name, email, phone }).catch(() => {});
  sendWelcomeEmail({ name, email, phone }).catch(() => {});

  res.status(201).json({
    success: true,
    pending: true,
    message: 'Account created. Contact the product owner to activate your account.',
  });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'Email/mobile and password are required' });
  }

  const isEmail = identifier.includes('@');
  let query;
  if (isEmail) {
    query = { email: identifier.toLowerCase().trim() };
  } else {
    // Accept plain digits (e.g. "9876543210") or full international ("+919876543210")
    const id = identifier.trim();
    const phones = id.startsWith('+') ? [id] : [id, `+91${id}`];
    query = { phone: { $in: phones } };
  }

  const user = await User.findOne(query).select('+password');
  if (!user) {
    const code    = isEmail ? 'EMAIL_NOT_FOUND' : 'PHONE_NOT_FOUND';
    const message = isEmail
      ? 'No account found with this email address.'
      : 'No account found with this mobile number.';
    return res.status(401).json({ success: false, code, message });
  }
  if (!(await user.comparePassword(password))) {
    return res.status(401).json({ success: false, code: 'WRONG_PASSWORD', message: 'Incorrect password. Please try again.' });
  }

  if (!user.isActive) {
    return res.status(403).json({
      success: false,
      code:    'ACCOUNT_INACTIVE',
      message: 'Your account is pending activation. Contact the product owner to enable your account.',
    });
  }

  const token = signToken(user._id);
  res.json({ success: true, token, data: { id: user._id, name: user.name, email: user.email, phone: user.phone, plan: user.plan } });
});

// GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.user });
});

// PUT /api/auth/me
const updateMe = asyncHandler(async (req, res) => {
  const { name, phone } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name cannot be empty' });
  }

  if (!phone || !/^(\+\d{7,15}|\d{10})$/.test(phone.trim())) {
    return res.status(400).json({ success: false, message: 'Enter a valid mobile number' });
  }

  const updated = await User.findByIdAndUpdate(
    req.user._id,
    { name: name.trim(), phone: phone.trim() },
    { new: true, runValidators: true }
  );

  res.json({ success: true, data: updated });
});

// PUT /api/auth/password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, message: 'New password must be different from the current one' });
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) {
    return res.status(401).json({ success: false, code: 'WRONG_CURRENT_PASSWORD', message: 'Current password is incorrect.' });
  }

  user.password = newPassword;
  await user.save({ validateModifiedOnly: true });

  res.json({ success: true, message: 'Password updated successfully.' });
});

module.exports = { register, login, getMe, updateMe, changePassword };
