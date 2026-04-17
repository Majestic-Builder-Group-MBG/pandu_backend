const jwt = require('jsonwebtoken');
const { tokenSecurityService } = require('../services/tokenSecurityService');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: token tidak ditemukan'
      });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    await tokenSecurityService.assertTokenNotRevoked(token);

    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role
    };
    req.token = token;

    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.status ? error.message : 'Unauthorized: token tidak valid atau expired'
    });
  }
};

module.exports = authMiddleware;
