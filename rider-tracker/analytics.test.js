const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDateSummary,
  buildSegments,
  computeSummary,
  detectAnomalies,
  enrichStores,
} = require('./analytics');

test('enrichStores derives exact backend visit times and dwell', () => {
  const stores = [
    { id: 'S1', name: 'Store One', orderCount: 0 },
    { id: 'S2', name: 'Store Two', orderCount: 0 },
  ];
  const orders = [
    { storeId: 'S1', orderTime: '2026-04-10T10:00:00Z' },
    { storeId: 'S1', orderTime: '2026-04-10T10:15:00Z' },
    { storeId: 'S2', orderTime: '2026-04-10T12:00:00Z' },
  ];

  const enriched = enrichStores(stores, orders);
  assert.equal(enriched[0].visited, true);
  assert.equal(enriched[0].visitTime, '2026-04-10T10:00:00.000Z');
  assert.equal(enriched[0].dwellMinutes, 15);
  assert.equal(enriched[1].dwellMinutes, 0);
});

test('buildSegments separates long gaps and totals routed distance', async () => {
  const pings = [
    { lat: 17, lng: 78, time: '2026-04-10T10:00:00Z' },
    { lat: 17.01, lng: 78.01, time: '2026-04-10T10:05:00Z' },
    { lat: 17.03, lng: 78.04, time: '2026-04-10T11:10:00Z' },
  ];

  const result = await buildSegments(
    pings,
    async () => ({ coords: [[0, 0], [1, 1]], distKm: 2, fallback: false }),
    15
  );

  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[1].isGap, true);
  assert.equal(result.totalKm, 2);
});

test('computeSummary and detectAnomalies expose operational risks', () => {
  const pings = [
    { lat: 17, lng: 78, time: '2026-04-10T10:00:00Z' },
    { lat: 17.01, lng: 78.01, time: '2026-04-10T10:10:00Z' },
    { lat: 17.02, lng: 78.02, time: '2026-04-10T11:30:00Z' },
  ];
  const segments = [
    { isGap: false, distKm: 3.2, straightKm: 2.9, gapMin: 10, fallback: false, fromTime: pings[0].time, toTime: pings[1].time },
    { isGap: true, distKm: 0, straightKm: 1.1, gapMin: 80, fallback: false, fromTime: pings[1].time, toTime: pings[2].time },
  ];
  const stores = [
    { id: 'S1', name: 'Visited', visited: true, dwellMinutes: 12, revisitCount: 1 },
    { id: 'S2', name: 'Missed', visited: false, dwellMinutes: 0, revisitCount: 0 },
  ];

  const summary = computeSummary(pings, segments, stores, 15);
  const anomalies = detectAnomalies(segments, stores);

  assert.equal(summary.longGapCount, 1);
  assert.equal(summary.storesCovered, 1);
  assert.equal(summary.storesMissed, 1);
  assert.ok(anomalies.some(item => item.type === 'long_gap'));
  assert.ok(anomalies.some(item => item.type === 'missed_store'));
  assert.ok(anomalies.some(item => item.type === 'revisit'));
});

test('buildDateSummary flags high distance days', () => {
  const summary = buildDateSummary('2026-04-10', [
    { lat: 17, lng: 78, time: '2026-04-10T10:00:00Z' },
    { lat: 17.2, lng: 78.2, time: '2026-04-10T10:30:00Z' },
  ]);

  assert.equal(summary.highDistance, true);
  assert.equal(summary.pings, 2);
});
