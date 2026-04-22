const { getRedisClient, isUsingRedis } = require('../config/redis');

const inMemoryBuckets = new Map();
let redisFailureLogged = false;

const getClientIp = (req) => req.ip || req.socket.remoteAddress || 'unknown';

const inMemoryCheck = ({ key, nowMs, windowMs, maxRequests }) => {
  const current = inMemoryBuckets.get(key);

  if (!current || nowMs > current.resetAt) {
    inMemoryBuckets.set(key, {
      count: 1,
      resetAt: nowMs + windowMs
    });
    return false;
  }

  if (current.count >= maxRequests) {
    return true;
  }

  current.count += 1;
  inMemoryBuckets.set(key, current);
  return false;
};

const redisCheck = async ({ redisClient, key, windowMs, maxRequests }) => {
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.pexpire(key, windowMs);
  }

  return count > maxRequests;
};

const createRateLimiter = ({ windowMs, maxRequests, message, keyPrefix }) => {
  return async (req, res, next) => {
    if (!isUsingRedis()) {
      return next();
    }

    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const nowMs = Date.now();

    try {
      const redisClient = await getRedisClient();

      if (redisClient) {
        const blocked = await redisCheck({ redisClient, key, windowMs, maxRequests });
        if (blocked) {
          return res.status(429).json({
            success: false,
            message
          });
        }

        return next();
      }

      const blocked = inMemoryCheck({ key, nowMs, windowMs, maxRequests });
      if (blocked) {
        return res.status(429).json({
          success: false,
          message
        });
      }

      return next();
    } catch (error) {
      if (!redisFailureLogged) {
        redisFailureLogged = true;
        console.warn(`[rate-limit] redis error, fallback memory limiter: ${error.message}`);
      }

      const blocked = inMemoryCheck({ key, nowMs, windowMs, maxRequests });
      if (blocked) {
        return res.status(429).json({
          success: false,
          message
        });
      }

      return next();
    }
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
