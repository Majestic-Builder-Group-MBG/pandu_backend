const jwt = require('jsonwebtoken');

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

class SessionContentViewTokenService {
  getSecret() {
    return process.env.SESSION_CONTENT_VIEW_TOKEN_SECRET || process.env.JWT_SECRET;
  }

  getTtlSeconds() {
    const parsed = Number(process.env.SESSION_CONTENT_VIEW_TOKEN_TTL_SECONDS || 120);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 120;
    }
    return Math.floor(parsed);
  }

  sign(payload) {
    const secret = this.getSecret();
    if (!secret) {
      throw createHttpError(500, 'Secret untuk view token belum diset');
    }

    return jwt.sign(payload, secret, {
      expiresIn: this.getTtlSeconds()
    });
  }

  verify(rawToken) {
    const secret = this.getSecret();
    if (!secret) {
      throw createHttpError(500, 'Secret untuk view token belum diset');
    }

    if (!rawToken || !String(rawToken).trim()) {
      throw createHttpError(401, 'Token view tidak ditemukan');
    }

    try {
      return jwt.verify(String(rawToken).trim(), secret);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw createHttpError(410, 'URL sudah expired, silakan kembali ke sistem untuk melihat ulang atau mengunduh.');
      }

      throw createHttpError(401, 'Token view tidak valid');
    }
  }
}

module.exports = {
  sessionContentViewTokenService: new SessionContentViewTokenService(),
  createHttpError
};
