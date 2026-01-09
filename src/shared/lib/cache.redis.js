import IORedis from 'ioredis';

// Make Redis opt-in. Set USE_REDIS=true in the environment to enable Redis.
const useRedis = process.env.USE_REDIS === 'true';
const redisUrl = useRedis ? (process.env.REDIS_URL || null) : null;

let redis = null;
let redisAvailable = false;

if (!useRedis) {
  console.log('[redis] disabled by USE_REDIS (not set to "true") - cache disabled');
} else if (redisUrl) {
  try {
    redis = new IORedis(redisUrl);
    redis.on('error', (err) => {
      redisAvailable = false;
      console.error('[redis] error', err?.message || err);
    });
    redis.on('connect', () => {
      redisAvailable = true;
      console.log('[redis] connected to', redisUrl);
    });
  } catch (e) {
    console.error('[redis] init failed', e?.message || e);
    redis = null;
  }
} else {
  console.log('[redis] REDIS_URL not set - cache disabled');
}

const noop = async () => null;

export const cacheGet = redis ? async (key) => {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return raw; }
  } catch (err) {
    console.debug('[redis] get error', err?.message || err);
    return null;
  }
} : noop;

export const cacheSet = redis ? async (key, value, ttlSeconds = 60) => {
  try {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    await redis.set(key, payload, 'EX', ttlSeconds);
  } catch (err) {
    console.debug('[redis] set error', err?.message || err);
  }
} : noop;

export const cacheDel = redis ? async (key) => {
  try { await redis.del(key); } catch (err) { console.debug('[redis] del error', err?.message || err); }
} : noop;

export default redis;
