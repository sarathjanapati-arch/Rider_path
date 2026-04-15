const { CACHE_TTL_MS } = require('../config');

const pairRouteCache = new Map();
const dayCache = new Map();

function withCache(cache, key, producer, ttlMs = CACHE_TTL_MS) {
  const existing = cache.get(key);
  const now = Date.now();
  if (existing && existing.expiresAt > now) {
    return existing.value;
  }

  const value = producer();
  if (value && typeof value.then === 'function') {
    const wrapped = value.catch(error => {
      const current = cache.get(key);
      if (current?.value === wrapped) {
        cache.delete(key);
      }
      throw error;
    });
    cache.set(key, { value: wrapped, expiresAt: now + ttlMs });
    return wrapped;
  }

  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

function clearRiderCache(riderId, date) {
  const suffix = `${riderId}:${date}`;
  for (const key of dayCache.keys()) {
    if (key.endsWith(suffix)) dayCache.delete(key);
  }
}

module.exports = { pairRouteCache, dayCache, withCache, clearRiderCache };
