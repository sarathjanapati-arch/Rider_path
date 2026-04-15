const DEFAULT_GAP_MINUTES = 15;
const LONG_GAP_MINUTES = 45;
const REVISIT_BREAK_MINUTES = 30;
const DETOUR_DISTANCE_KM = 2.5;

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function minutesBetween(a, b) {
  return (toDate(b) - toDate(a)) / 60000;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const a =
    sinLat * sinLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng;

  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function straightDistanceKm(a, b) {
  return +(haversineMeters(a.lat, a.lng, b.lat, b.lng) / 1000).toFixed(3);
}

function formatIso(value) {
  if (!value) return null;
  return toDate(value).toISOString();
}

function summarizeOrders(orderRows) {
  const grouped = new Map();

  for (const row of orderRows) {
    if (!grouped.has(row.storeId)) {
      grouped.set(row.storeId, []);
    }
    grouped.get(row.storeId).push(row);
  }

  const summary = new Map();

  for (const [storeId, rows] of grouped.entries()) {
    rows.sort((a, b) => toDate(a.orderTime) - toDate(b.orderTime));
    const firstOrder = rows[0]?.orderTime || null;
    const lastOrder = rows.at(-1)?.orderTime || null;

    let revisitCount = 0;
    for (let i = 1; i < rows.length; i += 1) {
      if (minutesBetween(rows[i - 1].orderTime, rows[i].orderTime) >= REVISIT_BREAK_MINUTES) {
        revisitCount += 1;
      }
    }

    summary.set(storeId, {
      orderCount: rows.length,
      visitTime: firstOrder,
      lastActivityTime: lastOrder,
      dwellMinutes: firstOrder && lastOrder ? +minutesBetween(firstOrder, lastOrder).toFixed(1) : 0,
      revisitCount,
      orderTimes: rows.map(row => formatIso(row.orderTime)),
    });
  }

  return summary;
}

function enrichStores(stores, orderRows) {
  const orderSummary = summarizeOrders(orderRows);

  return stores.map(store => {
    const orderMeta = orderSummary.get(store.id) || {
      orderCount: store.orderCount || 0,
      visitTime: null,
      lastActivityTime: null,
      dwellMinutes: 0,
      revisitCount: 0,
      orderTimes: [],
    };

    return {
      ...store,
      orderCount: orderMeta.orderCount || store.orderCount || 0,
      visitTime: formatIso(orderMeta.visitTime),
      lastActivityTime: formatIso(orderMeta.lastActivityTime),
      dwellMinutes: orderMeta.dwellMinutes,
      revisitCount: orderMeta.revisitCount,
      orderTimes: orderMeta.orderTimes,
      visited: Boolean(orderMeta.visitTime),
    };
  });
}

async function buildSegments(pings, routerFn, gapMinutes = DEFAULT_GAP_MINUTES) {
  if (pings.length < 2) {
    return { segments: [], totalKm: 0, straightKm: 0 };
  }

  const segments = [];
  let totalKm = 0;
  let straightKm = 0;

  for (let i = 0; i < pings.length - 1; i += 1) {
    const from = pings[i];
    const to = pings[i + 1];
    const gapMin = minutesBetween(from.time, to.time);
    const isGap = gapMin > gapMinutes;
    const straightKmStep = straightDistanceKm(from, to);
    const sameSpot = straightKmStep < 0.01;

    if (sameSpot) {
      continue;
    }

    let route = {
      coords: [[from.lat, from.lng], [to.lat, to.lng]],
      distKm: straightKmStep,
      fallback: true,
    };

    try {
      route = await routerFn(from, to);
    } catch {
      // fallback already set
    }

    if (!isGap) {
      totalKm += Number(route.distKm || 0);
    }
    straightKm += straightKmStep;

    segments.push({
      fromTime: formatIso(from.time),
      toTime: formatIso(to.time),
      coords: route.coords,
      isGap,
      distKm: +Number(route.distKm || 0).toFixed(3),
      gapMin: +gapMin.toFixed(1),
      straightKm: straightKmStep,
      fallback: Boolean(route.fallback),
    });
  }

  return {
    segments,
    totalKm: +totalKm.toFixed(2),
    straightKm: +straightKm.toFixed(2),
  };
}

function computeSummary(pings, segments, stores, gapMinutes = DEFAULT_GAP_MINUTES) {
  const firstPing = pings[0]?.time || null;
  const lastPing = pings.at(-1)?.time || null;
  const totalSpanMinutes = firstPing && lastPing ? minutesBetween(firstPing, lastPing) : 0;

  let idleMinutes = 0;
  for (let i = 1; i < pings.length; i += 1) {
    const gap = minutesBetween(pings[i - 1].time, pings[i].time);
    if (gap > gapMinutes) idleMinutes += gap;
  }

  const visitedStores = stores.filter(store => store.visited);
  const missedStores = stores.filter(store => !store.visited);
  const dwellValues = visitedStores.map(store => store.dwellMinutes).filter(Boolean);
  const averageStopDurationMinutes = dwellValues.length
    ? +(dwellValues.reduce((sum, value) => sum + value, 0) / dwellValues.length).toFixed(1)
    : 0;

  return {
    firstPing: formatIso(firstPing),
    lastPing: formatIso(lastPing),
    totalPingCount: pings.length,
    totalSpanMinutes: +totalSpanMinutes.toFixed(1),
    idleMinutes: +idleMinutes.toFixed(1),
    activeMinutes: +Math.max(totalSpanMinutes - idleMinutes, 0).toFixed(1),
    routeDistanceKm: +segments.filter(segment => !segment.isGap).reduce((sum, segment) => sum + segment.distKm, 0).toFixed(2),
    straightDistanceKm: +segments.reduce((sum, segment) => sum + segment.straightKm, 0).toFixed(2),
    gapCount: segments.filter(segment => segment.isGap).length,
    longGapCount: segments.filter(segment => segment.gapMin >= LONG_GAP_MINUTES).length,
    storesAssigned: stores.length,
    storesCovered: visitedStores.length,
    storesMissed: missedStores.length,
    averageStopDurationMinutes,
    totalDwellMinutes: +visitedStores.reduce((sum, store) => sum + (store.dwellMinutes || 0), 0).toFixed(1),
  };
}

function detectAnomalies(segments, stores) {
  const anomalies = [];

  for (const segment of segments) {
    if (segment.gapMin >= LONG_GAP_MINUTES) {
      anomalies.push({
        type: 'long_gap',
        severity: 'high',
        label: `Long gap of ${segment.gapMin} min`,
        details: `No location updates between ${segment.fromTime} and ${segment.toTime}.`,
      });
    }

    if (!segment.isGap && segment.distKm >= DETOUR_DISTANCE_KM && segment.fallback) {
      anomalies.push({
        type: 'route_fallback',
        severity: 'medium',
        label: `Fallback route over ${segment.distKm} km`,
        details: `Routing service fallback was used between ${segment.fromTime} and ${segment.toTime}.`,
      });
    }

    if (!segment.isGap && segment.distKm >= DETOUR_DISTANCE_KM * 2) {
      anomalies.push({
        type: 'detour',
        severity: 'medium',
        label: `Unusual travel segment of ${segment.distKm} km`,
        details: `Large movement detected between ${segment.fromTime} and ${segment.toTime}.`,
      });
    }
  }

  for (const store of stores) {
    if (!store.visited) {
      anomalies.push({
        type: 'missed_store',
        severity: 'high',
        label: `Assigned store missed: ${store.name}`,
        details: `No backend activity was found for store ${store.id}.`,
      });
    }

    if (store.revisitCount > 0) {
      anomalies.push({
        type: 'revisit',
        severity: 'medium',
        label: `${store.name} revisited ${store.revisitCount} time(s)`,
        details: `Orders suggest multiple separated visits for store ${store.id}.`,
      });
    }
  }

  return anomalies;
}

function buildDateSummary(day, pings) {
  const ordered = [...pings].sort((a, b) => toDate(a.time) - toDate(b.time));
  let approxKm = 0;
  let longGapCount = 0;

  for (let i = 1; i < ordered.length; i += 1) {
    approxKm += straightDistanceKm(ordered[i - 1], ordered[i]);
    if (minutesBetween(ordered[i - 1].time, ordered[i].time) >= LONG_GAP_MINUTES) {
      longGapCount += 1;
    }
  }

  return {
    day,
    pings: ordered.length,
    approxKm: +approxKm.toFixed(2),
    highDistance: approxKm >= 20,
    longGapCount,
    firstPing: formatIso(ordered[0]?.time || null),
    lastPing: formatIso(ordered.at(-1)?.time || null),
  };
}

module.exports = {
  DEFAULT_GAP_MINUTES,
  LONG_GAP_MINUTES,
  buildDateSummary,
  buildSegments,
  computeSummary,
  detectAnomalies,
  enrichStores,
  haversineMeters,
  minutesBetween,
  summarizeOrders,
};
