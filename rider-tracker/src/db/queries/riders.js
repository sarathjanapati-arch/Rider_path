const pool = require('../pool');
const { buildDateSummary } = require('../../../analytics');

async function queryRiderPings(riderId, date) {
  const { rows } = await pool.query(
    `
      SELECT CAST(latitude AS FLOAT) AS lat, CAST(longitude AS FLOAT) AS lng, date::text AS time
      FROM acin_oms.rider_live_location
      WHERE rider_id = $1 AND date::date = $2
        AND latitude IS NOT NULL AND latitude != ''
        AND longitude IS NOT NULL AND longitude != ''
      ORDER BY time
    `,
    [riderId, date]
  );
  return rows;
}

async function queryDateOverview(riderId) {
  const { rows } = await pool.query(
    `
      SELECT TO_CHAR(date::date, 'YYYY-MM-DD') AS day, CAST(latitude AS FLOAT) AS lat, CAST(longitude AS FLOAT) AS lng, date::text AS time
      FROM acin_oms.rider_live_location
      WHERE rider_id = $1
        AND latitude IS NOT NULL AND latitude != ''
        AND longitude IS NOT NULL AND longitude != ''
      ORDER BY date DESC
    `,
    [riderId]
  );

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.day)) grouped.set(row.day, []);
    grouped.get(row.day).push(row);
  }

  return [...grouped.entries()]
    .map(([day, pings]) => buildDateSummary(day, pings.reverse()))
    .sort((a, b) => b.day.localeCompare(a.day));
}

async function queryRiderProfiles() {
  const { rows } = await pool.query(
    `
      SELECT
        l.rider_id AS id,
        ep.first_name,
        ep.last_name
      FROM (
        SELECT DISTINCT rider_id FROM acin_oms.rider_live_location WHERE latitude IS NOT NULL AND latitude != ''
      ) l
      LEFT JOIN acin_auth.employee_profile ep
        ON ep.id = l.rider_id
      ORDER BY l.rider_id
    `
  );

  return rows.map(row => ({
    id: row.id,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.id,
  }));
}

async function queryRiderName(riderId) {
  const { rows } = await pool.query(
    `
      SELECT first_name, last_name
      FROM acin_auth.employee_profile
      WHERE id = $1
      LIMIT 1
    `,
    [riderId]
  );

  const row = rows[0];
  return [row?.first_name, row?.last_name].filter(Boolean).join(' ').trim() || riderId;
}

module.exports = { queryRiderPings, queryDateOverview, queryRiderProfiles, queryRiderName };
