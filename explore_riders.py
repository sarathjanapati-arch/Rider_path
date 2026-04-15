import psycopg2
from dotenv import load_dotenv
import os

load_dotenv()

conn = psycopg2.connect(
    host=os.getenv("DB_HOST"),
    port=os.getenv("DB_PORT"),
    dbname=os.getenv("DB_NAME"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD")
)
cur = conn.cursor()

RIDER_ID = "AL-E0000043"
DAY      = "2026-02-14"

# Orders on that specific day
cur.execute("""
    SELECT user_id, user_name, store_id, store_name, order_status
    FROM acin_oms.order_header
    WHERE rider_id = %s
      AND DATE(order_created_date) = %s
    ORDER BY order_created_date
""", (RIDER_ID, DAY))
orders = cur.fetchall()
print(f"Orders for rider {RIDER_ID} on {DAY}: {len(orders)}")
for o in orders:
    print(f"  user_id={o[0]}  store={o[2]}  status={o[4]}")

# Unique retailers on that day
unique_retailers = list({o[0] for o in orders if o[0]})
print(f"\nUnique retailers that day: {len(unique_retailers)}")

# How many of those have coordinates in address table
if unique_retailers:
    placeholders = ','.join(['%s'] * len(unique_retailers))
    cur.execute(f"""
        SELECT store_id, latitude, longitude
        FROM acin_auth.address
        WHERE store_id IN ({placeholders})
          AND latitude IS NOT NULL AND latitude != ''
    """, unique_retailers)
    with_coords = cur.fetchall()
    print(f"Of those, {len(with_coords)} have coordinates in address table")

cur.close()
conn.close()
