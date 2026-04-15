const pool = require('../pool');

async function queryStoreRows(riderId, date) {
  const { rows } = await pool.query(
    `
      SELECT
        user_id AS store_id,
        MAX(user_name) AS user_name,
        COUNT(*) AS order_count,
        MIN(order_created_date) AS first_order_time,
        MAX(order_created_date) AS last_order_time,
        ARRAY_AGG(order_created_date ORDER BY order_created_date) AS order_times
      FROM acin_oms.order_header
      WHERE rider_id = $1
        AND order_created_date::date = $2
        AND user_id IS NOT NULL
      GROUP BY user_id
      ORDER BY user_id
    `,
    [riderId, date]
  );
  return rows;
}

async function queryStoreAddresses(storeIds) {
  if (!storeIds.length) return [];
  const placeholders = storeIds.map((_, index) => `$${index + 1}`).join(',');
  const { rows } = await pool.query(
    `
      SELECT
        store_id,
        CAST(latitude AS FLOAT) AS lat,
        CAST(longitude AS FLOAT) AS lng,
        address_line1
      FROM acin_auth.address
      WHERE store_id IN (${placeholders})
        AND latitude IS NOT NULL AND latitude != ''
        AND longitude IS NOT NULL AND longitude != ''
    `,
    storeIds
  );
  return rows;
}

module.exports = { queryStoreRows, queryStoreAddresses };
