"""
Rider Distance Verification
============================
Calculates actual GPS distance per rider per day.
Use this to cross-check against distances claimed by riders for petrol expenses.

How it works:
  - Haversine formula between consecutive pings = GPS distance (straight line, minimum actual)
  - GPS distance x ROAD_FACTOR (1.3) = estimated road distance
  - Segments with time gap > GAP_THRESHOLD are excluded (app was closed / no signal)
  - Segments with speed > MAX_SPEED_KMPH are excluded (bad GPS jump)
"""

import psycopg2, csv
from dotenv import load_dotenv
from math import radians, sin, cos, sqrt, atan2
import os

load_dotenv()

ROAD_FACTOR    = 1.3   # multiply GPS km to get estimated road distance
GAP_THRESHOLD  = 15    # minutes — skip segment if gap is larger (app was closed)
MAX_SPEED_KMPH = 80    # km/h  — skip segment if speed is unrealistically high

def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))

def analyze_day(pings):
    gps_km = 0.0
    gaps, bad = [], []

    for i in range(1, len(pings)):
        lat1, lon1, t1 = pings[i-1]
        lat2, lon2, t2 = pings[i]
        minutes = (t2 - t1).total_seconds() / 60
        seg_km  = haversine_km(lat1, lon1, lat2, lon2)
        speed   = (seg_km / (minutes / 60)) if minutes > 0 else 0

        if minutes > GAP_THRESHOLD:
            gaps.append(round(minutes, 1))
            continue
        if speed > MAX_SPEED_KMPH:
            bad.append(round(seg_km, 2))
            continue

        gps_km += seg_km

    return {
        "pings":             len(pings),
        "gps_km":            round(gps_km, 2),
        "road_km":           round(gps_km * ROAD_FACTOR, 2),
        "active_hrs":        round((pings[-1][2] - pings[0][2]).total_seconds() / 3600, 2),
        "gap_count":         len(gaps),
        "uncovered_min":     round(sum(gaps), 1),
        "bad_gps_count":     len(bad),
        "start":             pings[0][2],
        "end":               pings[-1][2],
    }

def main():
    conn = get_connection()
    cur  = conn.cursor()

    # All rider-days with at least 5 pings
    cur.execute("""
        SELECT rider_id, DATE(date) AS day, COUNT(*) AS pings
        FROM acin_oms.rider_live_location
        WHERE latitude IS NOT NULL AND latitude != ''
          AND longitude IS NOT NULL AND longitude != ''
        GROUP BY rider_id, day
        HAVING COUNT(*) >= 5
        ORDER BY rider_id, day
    """)
    rider_days = cur.fetchall()
    print(f"Analyzing {len(rider_days)} rider-day records...\n")

    daily_rows = []
    for rider_id, day, _ in rider_days:
        cur.execute("""
            SELECT CAST(latitude AS FLOAT), CAST(longitude AS FLOAT), date
            FROM acin_oms.rider_live_location
            WHERE rider_id = %s AND DATE(date) = %s
              AND latitude IS NOT NULL AND latitude != ''
              AND longitude IS NOT NULL AND longitude != ''
            ORDER BY date
        """, (rider_id, day))
        pings = cur.fetchall()
        stats = analyze_day(pings)
        stats["rider_id"] = rider_id
        stats["day"]      = day
        daily_rows.append(stats)

    # ── Daily Report ──────────────────────────────────────────────────────────
    print("=" * 105)
    print("DAILY GPS DISTANCE REPORT")
    print(f"  Road factor: x{ROAD_FACTOR}  |  Gap threshold: {GAP_THRESHOLD} min  |  Max speed: {MAX_SPEED_KMPH} km/h")
    print("=" * 105)
    print(f"{'Rider':<16} {'Date':<12} {'Pings':>5} {'GPS km':>7} {'Est.Road km':>12} "
          f"{'Active h':>9} {'Gaps':>5} {'Uncov.min':>10}  Flags")
    print("-" * 105)
    for r in daily_rows:
        flags = ""
        if r["gap_count"]:
            flags += f" [GAP x{r['gap_count']}, {r['uncovered_min']} min unknown]"
        if r["bad_gps_count"]:
            flags += f" [BAD GPS x{r['bad_gps_count']}]"
        print(f"{r['rider_id']:<16} {str(r['day']):<12} {r['pings']:>5} "
              f"{r['gps_km']:>7.2f} {r['road_km']:>12.2f} "
              f"{r['active_hrs']:>9.2f} {r['gap_count']:>5} {r['uncovered_min']:>10.1f}  {flags}")

    # ── Monthly Summary per Rider ─────────────────────────────────────────────
    from collections import defaultdict
    summary = defaultdict(lambda: {"days": 0, "gps_km": 0.0, "road_km": 0.0,
                                   "total_gaps": 0, "total_uncov_min": 0.0})
    for r in daily_rows:
        s = summary[r["rider_id"]]
        s["days"]           += 1
        s["gps_km"]         += r["gps_km"]
        s["road_km"]        += r["road_km"]
        s["total_gaps"]     += r["gap_count"]
        s["total_uncov_min"]+= r["uncovered_min"]

    print("\n" + "=" * 90)
    print("MONTHLY SUMMARY PER RIDER  (use Est. Road km to compare against claimed distances)")
    print("=" * 90)
    print(f"{'Rider':<16} {'Days':>5} {'Total GPS km':>13} {'Total Est.Road km':>18} "
          f"{'Total Gaps':>11} {'Uncov. hrs':>11}")
    print("-" * 90)
    for rider_id, s in sorted(summary.items()):
        print(f"{rider_id:<16} {s['days']:>5} {s['gps_km']:>13.2f} {s['road_km']:>18.2f} "
              f"{s['total_gaps']:>11} {s['total_uncov_min']/60:>11.1f}")

    print("\n" + "=" * 90)
    print("LEGEND")
    print(f"  GPS km          : Sum of straight lines between pings (minimum actual distance)")
    print(f"  Est. Road km    : GPS km x {ROAD_FACTOR}  — accounts for road curves, closer to real travel")
    print(f"  Gaps            : Periods >{GAP_THRESHOLD} min with no GPS ping — app closed or no signal")
    print(f"  Uncov. hrs/min  : Total time with NO GPS coverage — distance during this is UNKNOWN")
    print(f"  BAD GPS         : Ping-to-ping speed exceeded {MAX_SPEED_KMPH} km/h — GPS jump, excluded")
    print()
    print("HOW TO VERIFY RIDER CLAIMS:")
    print("  1. Collect the distance each rider claims for a given day")
    print("  2. Compare with 'Est. Road km' from this report")
    print("  3. If claimed > Est.Road km by more than 30% -- flag for review")
    print("  4. Check 'Gaps' — large uncovered time means some distance cannot be verified by GPS")
    print("  5. Riders with consistent large gaps may be closing the app deliberately")

    # ── Export CSV for Excel ──────────────────────────────────────────────────
    csv_path = "distance_report.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "rider_id", "date", "pings", "start_time", "end_time",
            "active_hrs", "gps_km", "est_road_km",
            "gap_count", "uncovered_min", "bad_gps_count",
            "claimed_km (fill this)",  "difference (fill formula)"
        ])
        for r in daily_rows:
            writer.writerow([
                r["rider_id"], r["day"], r["pings"],
                r["start"], r["end"], r["active_hrs"],
                r["gps_km"], r["road_km"],
                r["gap_count"], r["uncovered_min"], r["bad_gps_count"],
                "",  # to be filled with rider's claimed distance
                ""   # formula: claimed - est_road_km
            ])
    print(f"\nCSV exported: {csv_path}")
    print("  Fill in 'claimed_km' column with what each rider submitted.")
    print("  Add formula =M2-H2 in 'difference' column to see over/under claims.")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
