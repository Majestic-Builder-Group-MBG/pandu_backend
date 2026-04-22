const Redis = require('ioredis');

let redisClient = null;
let redisInitAttempted = false;

const toBoolean = (value) => String(value || '').trim().toLowerCase() === 'true';
const toNumber = (value, fallbackValue) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
};

const isUsingRedis = () => toBoolean(process.env.USING_REDIS);
const getRedisMode = () => {
  const normalizedMode = String(process.env.REDIS_MODE || 'local').trim().toLowerCase();
  return normalizedMode === 'cloud' ? 'cloud' : 'local';
};

const buildRedisOptions = () => {
  const mode = getRedisMode();
  const tlsFromEnv = toBoolean(process.env.REDIS_TLS);
  const shouldUseTls = mode === 'cloud' ? true : tlsFromEnv;

  const options = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: toNumber(process.env.REDIS_PORT, 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    db: toNumber(process.env.REDIS_DB, 0),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  };

  if (shouldUseTls) {
    options.tls = {};
  }

  return options;
};

const getRedisClient = async () => {
  if (!isUsingRedis()) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  if (redisInitAttempted) {
    return null;
  }

  redisInitAttempted = true;

  try {
    redisClient = new Redis(buildRedisOptions());
    redisClient.on('error', (error) => {
      console.warn(`[redis] ${error.message}`);
    });
    await redisClient.connect();
    console.log(`[redis] connected for rate limiting (mode=${getRedisMode()})`);
    return redisClient;
  } catch (error) {
    console.warn(`[redis] gagal konek: ${error.message}`);
    redisClient = null;
    return null;
  }
};

module.exports = {
  isUsingRedis,
  getRedisMode,
  getRedisClient
};
