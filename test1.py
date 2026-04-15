from db_connect import get_connection

def main():
    try:
        conn = get_connection()
        cur = conn.cursor()
        
        query = "SELECT * FROM acin_oms.rider_live_location rll WHERE rll.rider_id = %s"
        rider_id = 'AL-E0000125'
        
        print(f"Executing query for rider_id: {rider_id}...")
        cur.execute(query, (rider_id,))
        
        rows = cur.fetchall()
        
        if not rows:
            print("No data found for this rider.")
        else:
            # Get column names from cursor description
            colnames = [desc[0] for desc in cur.description]
            print(f"\nResults ({len(rows)} row(s)):")
            print("-" * 50)
            
            for row in rows:
                # Zip column names with row values for a more readable output
                row_dict = dict(zip(colnames, row))
                for col, val in row_dict.items():
                    print(f"{col}: {val}")
                print("-" * 50)

        cur.close()
        conn.close()
        
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    main()
