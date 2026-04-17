const createRateLimiter = ({ windowMs, maxRequests, message, keyPrefix }) => {
  const bucket = new Map();

  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    const current = bucket.get(key);
    if (!current || now > current.resetAt) {
      bucket.set(key, {
        count: 1,
        resetAt: now + windowMs
      });
      return next();
    }

    if (current.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        message
      });
    }

    current.count += 1;
    bucket.set(key, current);
    return next();
  };
};

const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 40,
  keyPrefix: 'auth',
  message: 'Terlalu banyak percobaan autentikasi. Silakan coba lagi dalam 15 menit.'
});

const codeIssueRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 100,
  keyPrefix: 'registration-code-issue',
  message: 'Terlalu banyak pembuatan kode registrasi. Silakan coba lagi nanti.'
});

module.exports = {
  createRateLimiter,
  authRateLimiter,
  codeIssueRateLimiter
};
