const jwt        = require('jsonwebtoken');
const SuperAdmin = require('../models/SuperAdmin');

const protectSuperAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Superadmin access only' });
    }

    req.superAdmin = await SuperAdmin.findById(decoded.id).select('-password');
    if (!req.superAdmin || !req.superAdmin.isActive) {
      return res.status(401).json({ success: false, message: 'Account not found or inactive' });
    }

    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

module.exports = { protectSuperAdmin };
