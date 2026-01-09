import { cacheGet, cacheSet } from "../lib/cache.redis.js";

export const responseCache = ({ ttl = 60, getKey } = {}) => {
  return async (req, res, next) => {
    try {
      if (req.method !== 'GET') return next();

      const key = getKey ? getKey(req) : `cache:${req.originalUrl}:${req.userId || 'anon'}`;
      const cached = await cacheGet(key);
      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(cached);
      }

      const originalJson = res.json.bind(res);
      res.json = async (body) => {
        try {
          // only cache successful JSON responses
          if (res.statusCode === 200) {
            await cacheSet(key, body, ttl);
            res.set('X-Cache', 'MISS');
          }
        } catch (err) {
          console.error('[cache] set failed', err?.message || err);
        }
        return originalJson(body);
      };

      return next();
    } catch (err) {
      console.error('[cache] middleware error', err?.message || err);
      return next();
    }
  };
};

export default responseCache;
