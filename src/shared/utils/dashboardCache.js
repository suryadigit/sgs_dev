const cache = new Map();

export const CACHE_KEYS = {
  COMMISSION_STATS: (affiliateId) => `commissions:${affiliateId}`,
  REFERRAL_TREE: (affiliateId) => `referrals:${affiliateId}`,
  DASHBOARD_SUMMARY: (userId) => `dashboard:${userId}`,
};

const DEFAULT_TTL = 5 * 60 * 1000;

export const getCache = (key) => {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  
  return entry.value;
};

export const setCache = (key, value, ttl = DEFAULT_TTL) => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttl,
  });
};

export const invalidateAffiliateCache = (affiliateId) => {
  cache.delete(CACHE_KEYS.COMMISSION_STATS(affiliateId));
  cache.delete(CACHE_KEYS.REFERRAL_TREE(affiliateId));
};
export const invalidateUserCache = (userId) => {
  cache.delete(CACHE_KEYS.DASHBOARD_SUMMARY(userId));
};

export const clearAllCache = () => {
  cache.clear();
};

export const getCacheStats = () => {
  let activeCount = 0;
  let expiredCount = 0;

  for (const [key, entry] of cache.entries()) {
    if (Date.now() > entry.expiresAt) {
      expiredCount++;
      cache.delete(key);
    } else {
      activeCount++;
    }
  }

  return {
    total: cache.size,
    active: activeCount,
    expired: expiredCount,
  };
};

export default {
  getCache,
  setCache,
  invalidateAffiliateCache,
  invalidateUserCache,
  clearAllCache,
  getCacheStats,
  CACHE_KEYS,
};
