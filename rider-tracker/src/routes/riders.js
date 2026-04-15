const { Router } = require('express');
const { asyncHandler } = require('../utils');
const { queryRiderProfiles, queryRiderPings, queryDateOverview } = require('../db/queries/riders');
const { buildDayPayload } = require('../services/dayBuilder');
const { buildDailyCsv, buildDailyPdf } = require('../../reports');
const { authRequired, PORT, VALHALLA_URL } = require('../config');

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    authEnabled: Boolean(process.env.AUTH_USER && process.env.AUTH_PASSWORD),
    port: process.env.PORT,
    valhallaUrl: process.env.VALHALLA_URL,
  });
});

router.get('/riders', asyncHandler(async (req, res) => {
  res.json(await queryRiderProfiles());
}));

router.get('/riders/:id/dates', asyncHandler(async (req, res) => {
  res.json(await queryDateOverview(req.params.id));
}));

router.get('/riders/:id/pings/:date', asyncHandler(async (req, res) => {
  res.json(await queryRiderPings(req.params.id, req.params.date));
}));

router.get('/riders/:id/stores/:date', asyncHandler(async (req, res) => {
  const payload = await buildDayPayload(req.params.id, req.params.date);
  res.json(payload.stores);
}));

router.get('/riders/:id/route/:date', asyncHandler(async (req, res) => {
  const payload = await buildDayPayload(req.params.id, req.params.date);
  res.json({
    segments: payload.segments,
    totalKm: payload.totalKm,
    straightKm: payload.straightKm,
  });
}));

router.get('/riders/:id/day/:date', asyncHandler(async (req, res) => {
  res.json(await buildDayPayload(req.params.id, req.params.date));
}));

router.get('/riders/:id/export/:date.csv', asyncHandler(async (req, res) => {
  const payload = await buildDayPayload(req.params.id, req.params.date);
  const csv = buildDailyCsv(payload);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rider-${req.params.id}-${req.params.date}.csv"`);
  res.send(csv);
}));

router.get('/riders/:id/export/:date.pdf', asyncHandler(async (req, res) => {
  const payload = await buildDayPayload(req.params.id, req.params.date);
  const pdf = buildDailyPdf(payload);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="rider-${req.params.id}-${req.params.date}.pdf"`);
  res.send(pdf);
}));

module.exports = router;
