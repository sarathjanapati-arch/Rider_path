const pool = require('./src/db/pool');

async function searchAnyLocationColumn() {
  try {
    const { rows } = await pool.query(`
      SELECT table_schema, table_name, column_name
      FROM information_schema.columns
      WHERE column_name ILIKE '%latitude%' OR column_name ILIKE '%longitude%'
    `);
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

searchAnyLocationColumn();
