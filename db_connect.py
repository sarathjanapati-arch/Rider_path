import psycopg2
from dotenv import load_dotenv
import os

load_dotenv(override=True)

def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )

def describe_table(cursor, schema, table):
    cursor.execute("""
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ordinal_position;
    """, (schema, table))
    rows = cursor.fetchall()
    print(f"\n--- {schema}.{table} ---")
    print(f"{'Column':<35} {'Type':<25} {'Nullable':<10} {'Default'}")
    print("-" * 90)
    for col, dtype, nullable, default in rows:
        print(f"{col:<35} {dtype:<25} {nullable:<10} {str(default or '')}")

def sample_data(cursor, schema, table, limit=5):
    cursor.execute(f"SELECT * FROM {schema}.{table} LIMIT %s;", (limit,))
    rows = cursor.fetchall()
    cols = [desc[0] for desc in cursor.description]
    print(f"\n  Sample rows ({schema}.{table}):")
    print("  " + " | ".join(cols))
    print("  " + "-" * 100)
    for row in rows:
        print("  " + " | ".join(str(v) for v in row))

def main():
    try:
        conn = get_connection()
        print("Connection successful!")
        print("Server version:", conn.server_version)
        cur = conn.cursor()

        tables = [
            ("acin_oms", "rider_live_location"),
            ("acin_oms", "order_header"),
            ("acin_auth", "address"),
        ]

        for schema, table in tables:
            describe_table(cur, schema, table)
            sample_data(cur, schema, table)

        cur.close()
        conn.close()

    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    main()
