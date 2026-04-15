const { buildSegments, computeSummary, detectAnomalies, enrichStores } = require('../../analytics');
const { GAP_MINUTES } = require('../config');
const { dayCache, withCache } = require('./cache');
const { valhallaRoute } = require('./routing');
const { queryRiderPings, queryRiderName } = require('../db/queries/riders');
const { queryStoreRows, queryStoreAddresses } = require('../db/queries/stores');

async function buildStores(riderId, date) {
  const orderRows = await queryStoreRows(riderId, date);
  if (!orderRows.length) return [];

  const storeIds = orderRows.map(row => row.store_id);
  const addresses = await queryStoreAddresses(storeIds);
  const addressMap = new Map(addresses.map(row => [row.store_id, row]));

  const baseStores = orderRows
    .filter(row => addressMap.has(row.store_id))
    .map(row => ({
      id: row.store_id,
      name: row.user_name || row.store_id,
      orderCount: Number(row.order_count || 0),
      lat: addressMap.get(row.store_id).lat,
      lng: addressMap.get(row.store_id).lng,
      address: addressMap.get(row.store_id).address_line1,
    }));

  const normalizedOrderRows = orderRows.flatMap(row =>
    (row.order_times || []).map(orderTime => ({
      storeId: row.store_id,
      orderTime,
    }))
  );

  return enrichStores(baseStores, normalizedOrderRows);
}

async function buildDayPayload(riderId, date) {
  const cacheKey = `day:${riderId}:${date}`;
  return withCache(dayCache, cacheKey, async () => {
    const [pings, stores, riderName] = await Promise.all([
      queryRiderPings(riderId, date),
      buildStores(riderId, date),
      queryRiderName(riderId),
    ]);

    const route = await buildSegments(pings, valhallaRoute, GAP_MINUTES);
    const summary = computeSummary(pings, route.segments, stores, GAP_MINUTES);
    const anomalies = detectAnomalies(route.segments, stores);

    return {
      riderId,
      riderName,
      date,
      pings,
      stores,
      segments: route.segments,
      totalKm: route.totalKm,
      straightKm: route.straightKm,
      summary,
      anomalies,
    };
  });
}

module.exports = { buildStores, buildDayPayload };
