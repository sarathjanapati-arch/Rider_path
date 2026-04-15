const pool = require('../db/pool');
const { queryRiderPings } = require('../db/queries/riders');
const { valhallaRoute } = require('../services/routing');
const { clearRiderCache } = require('../services/cache');
const { parseCookies, getSession } = require('../middleware/auth');
const { SESSION_COOKIE_NAME } = require('../config');
const { getIndiaDateString } = require('../utils');

function setupLive(io) {
  io.use((socket, next) => {
    const { AUTH_USER, AUTH_PASSWORD } = require('../config');
    if (!AUTH_USER || !AUTH_PASSWORD) return next();
    const cookies = parseCookies(socket.handshake.headers.cookie || '');
    const session = getSession(cookies[SESSION_COOKIE_NAME] || '');
    if (session) return next();
    next(new Error('Authentication required'));
  });

  io.on('connection', socket => {
    let liveTimer = null;
    let lastSeen = null;
    let lastPoint = null;

    socket.on('subscribe_live', async ({ riderId }) => {
      if (liveTimer) clearInterval(liveTimer);

      const today = getIndiaDateString();
      const history = await queryRiderPings(riderId, today).catch(() => []);
      lastSeen = history.at(-1)?.time || new Date(Date.now() - 60 * 60 * 1000);
      lastPoint = history.at(-1) || null;

      socket.emit('live_snapshot', {
        riderId,
        pings: history.slice(-50),
      });

      liveTimer = setInterval(async () => {
        try {
          const liveDay = getIndiaDateString();
          const { rows } = await pool.query(
            `
              SELECT CAST(latitude AS FLOAT) AS lat, CAST(longitude AS FLOAT) AS lng, date::text AS time
              FROM acin_oms.rider_live_location
              WHERE rider_id = $1 AND date > $2
                AND latitude IS NOT NULL AND latitude != ''
                AND longitude IS NOT NULL AND longitude != ''
              ORDER BY date
            `,
            [riderId, lastSeen]
          );

          if (!rows.length) return;

          lastSeen = rows.at(-1).time;
          const routeSegments = [];

          for (const row of rows) {
            if (lastPoint) {
              try {
                const route = await valhallaRoute(lastPoint, row);
                routeSegments.push({
                  coords: route.coords,
                  distKm: route.distKm,
                  fromTime: lastPoint.time,
                  toTime: row.time,
                  fallback: false,
                });
              } catch {
                routeSegments.push({
                  coords: [[lastPoint.lat, lastPoint.lng], [row.lat, row.lng]],
                  distKm: 0,
                  fromTime: lastPoint.time,
                  toTime: row.time,
                  fallback: true,
                });
              }
            }
            lastPoint = row;
          }

          clearRiderCache(riderId, liveDay);
          socket.emit('new_pings', { pings: rows, routeSegments });
        } catch (error) {
          console.error('Live poll error:', error.message);
        }
      }, 15000);
    });

    socket.on('unsubscribe_live', () => {
      if (liveTimer) clearInterval(liveTimer);
      liveTimer = null;
    });

    socket.on('disconnect', () => {
      if (liveTimer) clearInterval(liveTimer);
    });
  });
}

module.exports = { setupLive };
