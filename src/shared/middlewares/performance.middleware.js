import compression from "compression";
import crypto from "crypto";

/* ================================
   PATH GROUPING
================================ */
const CACHE_PATHS = {
  PUBLIC: ['/dashboard/', '/referrals'],
  PRIVATE: ['/profile'],
  NO_CACHE: ['/payments', '/auth'],
};

const isMatchPath = (path, patterns = []) =>
  patterns.some(p => path.includes(p));

/* ================================
   HTTP CACHING
================================ */
export const httpCaching = (req, res, next) => {
  const { path } = req;

  if (isMatchPath(path, CACHE_PATHS.PUBLIC)) {
    res.set('Cache-Control', 'public, max-age=120');
  } 
  else if (isMatchPath(path, CACHE_PATHS.PRIVATE)) {
    res.set('Cache-Control', 'private, max-age=60');
  } 
  else if (isMatchPath(path, CACHE_PATHS.NO_CACHE)) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }

  next();
};

/* ================================
   RESPONSE TIMER + ETAG
================================ */
export const responseTimer = (req, res, next) => {
  const startTime = Date.now();
  const originalJson = res.json;

  res.json = function (data) {
    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);

    if (duration > 500) {
      console.warn(
        `⚠️ Slow API: ${req.method} ${req.originalUrl} (${duration}ms)`
      );
    }

    // ETag only for cacheable endpoints
    if (isMatchPath(req.path, CACHE_PATHS.PUBLIC)) {
      try {
        const body = typeof data === 'string'
          ? data
          : JSON.stringify(data ?? {});
          
        const etag = crypto
          .createHash('md5')
          .update(body)
          .digest('hex');

        res.set('ETag', `"${etag}"`);
      } catch (err) {
        console.error('ETag error:', err?.message || err);
      }
    }

    return originalJson.call(this, data);
  };

  next();
};

/* ================================
   COMPRESSION
================================ */
export const setupCompression = (app) => {
  app.use(
    compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compress']) return false;
        return compression.filter(req, res);
      },
    })
  );
};

/* ================================
   EXPORT
================================ */
export default {
  httpCaching,
  responseTimer,
  setupCompression,
};
