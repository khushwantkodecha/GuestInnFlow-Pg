const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;
  const user = await User.create({ name, email, password, phone });

  const token = signToken(user._id);
  res.status(201).json({ success: true, token, data: { id: user._id, name: user.name, email: user.email } });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const token = signToken(user._id);
  res.json({ success: true, token, data: { id: user._id, name: user.name, email: user.email } });
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

  if (phone && !/^\d{10}$/.test(phone.trim())) {
    return res.status(400).json({ success: false, message: 'Phone must be exactly 10 digits' });
  }

  const updated = await User.findByIdAndUpdate(
    req.user._id,
    { name: name.trim(), phone: phone ? phone.trim() : undefined },
    { new: true, runValidators: true }
  );

  res.json({ success: true, data: updated });
});

module.exports = { register, login, getMe, updateMe };
