import psycopg2
from dotenv import load_dotenv
import os
import folium
from folium.plugins import AntPath, MarkerCluster
from shapely.geometry import LineString, Point
import requests
import time

load_dotenv()

RIDER_ID     = "AL-E0000043"
DAY          = "2026-02-14"
NEAR_PATH_KM = 3.0   # stores within this km from path are highlighted

def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )

def fetch_rider_path(cur):
    cur.execute("""
        SELECT CAST(latitude AS FLOAT), CAST(longitude AS FLOAT), date
        FROM acin_oms.rider_live_location
        WHERE rider_id = %s
          AND DATE(date) = %s
          AND latitude IS NOT NULL AND latitude != ''
          AND longitude IS NOT NULL AND longitude != ''
        ORDER BY date
    """, (RIDER_ID, DAY))
    return cur.fetchall()

def fetch_stores(cur):
    """Get retailers assigned to this rider on the specific DAY only."""
    cur.execute("""
        SELECT DISTINCT oh.user_id, oh.user_name,
               COUNT(*) OVER (PARTITION BY oh.user_id) AS order_count
        FROM acin_oms.order_header oh
        WHERE oh.rider_id = %s
          AND DATE(oh.order_created_date) = %s
          AND oh.user_id IS NOT NULL
    """, (RIDER_ID, DAY))
    retailers = cur.fetchall()
    user_ids   = [r[0] for r in retailers]
    name_map   = {r[0]: r[1] for r in retailers}
    count_map  = {r[0]: r[2] for r in retailers}

    if not user_ids:
        return []

    placeholders = ','.join(['%s'] * len(user_ids))
    cur.execute(f"""
        SELECT store_id, CAST(latitude AS FLOAT), CAST(longitude AS FLOAT)
        FROM acin_auth.address
        WHERE store_id IN ({placeholders})
          AND latitude IS NOT NULL AND latitude != ''
          AND longitude IS NOT NULL AND longitude != ''
    """, user_ids)

    return [
        {
            "id":          sid,
            "name":        name_map.get(sid, sid),
            "order_count": count_map.get(sid, 1),
            "lat":         lat,
            "lng":         lng,
        }
        for sid, lat, lng in cur.fetchall()
    ]

def decode_polyline6(encoded):
    """Decode Valhalla's precision-6 encoded polyline to [(lat, lng), ...]."""
    coords = []
    index = lat = lng = 0
    while index < len(encoded):
        for is_lng in (False, True):
            result = shift = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            value = (~(result >> 1)) if (result & 1) else (result >> 1)
            if is_lng:
                lng += value
            else:
                lat += value
        coords.append((lat / 1e6, lng / 1e6))
    return coords

GAP_MINUTES = 15   # gaps larger than this = app was closed, unknown path

def route_segment(waypoints):
    """Call Valhalla /route for a list of waypoints. Returns (road_coords, dist_km)."""
    VALHALLA_URL = "https://valhalla1.openstreetmap.de/route"
    payload = {
        "locations": waypoints,
        "costing": "auto",
        "directions_options": {"units": "kilometers"}
    }
    for attempt in range(3):
        resp = requests.post(VALHALLA_URL, json=payload, timeout=20)
        if resp.status_code == 429:
            wait = (attempt + 1) * 5
            print(f"    Rate limited — waiting {wait}s ...")
            time.sleep(wait)
            continue
        if resp.status_code != 200:
            raise ValueError(f"HTTP {resp.status_code}: {resp.text[:200]}")
        break
    else:
        raise ValueError("Max retries exceeded")

    legs = resp.json().get("trip", {}).get("legs", [])
    if not legs:
        raise ValueError("No legs returned")

    road_coords, dist_km = [], 0.0
    for leg in legs:
        road_coords += decode_polyline6(leg.get("shape", ""))
        dist_km     += leg.get("summary", {}).get("length", 0)
    return road_coords, dist_km

def get_road_path(pings):
    """
    Routes between EVERY consecutive GPS ping pair via Valhalla /route.
    Every ping is connected to the next — full day path, nothing skipped.

    - Small gap (< GAP_MINUTES) : solid animated red line  (active travel)
    - Large gap (>= GAP_MINUTES): dashed grey line         (app was closed)

    Returns:
        road_segments : list of (coords [(lat,lng),...], is_gap bool)
        total_dist_km : total verified road distance (active segments only)
    """
    road_segments = []
    total_dist_km = 0.0
    total_pairs   = len(pings) - 1

    print(f"  Routing {total_pairs} ping-to-ping segments via Valhalla ...")

    for i in range(total_pairs):
        lat1, lng1, t1 = pings[i]
        lat2, lng2, t2 = pings[i + 1]
        gap_min = (t2 - t1).total_seconds() / 60
        is_gap  = gap_min > GAP_MINUTES

        # Skip routing if start == end (stationary ping)
        same_spot = ((lat1 - lat2)**2 + (lng1 - lng2)**2)**0.5 < 0.00005
        if same_spot:
            continue

        waypoints = [{"lat": lat1, "lon": lng1},
                     {"lat": lat2, "lon": lng2}]
        try:
            road_coords, dist_km = route_segment(waypoints)
            if not is_gap:
                total_dist_km += dist_km
            road_segments.append((road_coords, is_gap))
            print(f"    [{i+1}/{total_pairs}] {'GAP' if is_gap else 'OK ':3s}  "
                  f"{gap_min:5.1f} min gap  {dist_km:.2f} km road")
        except Exception as e:
            print(f"    [{i+1}/{total_pairs}] failed ({e}) — straight line")
            road_segments.append(([(lat1, lng1), (lat2, lng2)], is_gap))

        time.sleep(1.0)

    print(f"  Active road distance: {total_dist_km:.2f} km")
    return road_segments, total_dist_km

def dist_km_to_path(path_line, lat, lng):
    dist_deg = path_line.distance(Point(lng, lat))
    return round(dist_deg * 111.0, 2)

def build_map(path_points, stores):
    coords = [(lat, lng) for lat, lng, _ in path_points]
    times  = [str(t) for _, _, t in path_points]

    # ── Snap GPS pings to real roads via Valhalla ────────────────────────────
    road_segments, road_dist_km = get_road_path(path_points)

    # Flatten all coords for centre + proximity calculations
    all_road_coords = [pt for seg, _ in road_segments for pt in seg]
    simplified = LineString([(lng, lat) for lat, lng in all_road_coords])

    center_lat = sum(c[0] for c in coords) / len(coords)
    center_lng = sum(c[1] for c in coords) / len(coords)
    path_coords = all_road_coords   # alias used by START/END markers below

    m = folium.Map(location=[center_lat, center_lng], zoom_start=13,
                   tiles="CartoDB positron")

    # ── Feature groups (toggleable layers) ──────────────────────────────────
    grp_path  = folium.FeatureGroup(name="Rider Path", show=True)
    grp_near  = folium.FeatureGroup(name="Stores Near Path", show=True)
    grp_far   = folium.FeatureGroup(name="Other Stores", show=True)

    # ── Draw each segment: solid road line or dashed gap line ───────────────
    for seg_coords, is_gap in road_segments:
        if len(seg_coords) < 2:
            continue
        if is_gap:
            # Dashed grey line — app was closed, path unknown
            folium.PolyLine(
                seg_coords, color="#9E9E9E", weight=2,
                opacity=0.7, dash_array="8 8",
                tooltip="GPS gap — app was closed"
            ).add_to(grp_path)
        else:
            # Shadow
            folium.PolyLine(seg_coords, color="#455A64",
                            weight=8, opacity=0.2).add_to(grp_path)
            # Animated road path
            AntPath(
                seg_coords, color="#E53935", weight=5,
                opacity=0.9, delay=600, dash_array=[15, 25],
                tooltip=f"Rider {RIDER_ID} | {DAY} | {road_dist_km:.2f} km"
            ).add_to(grp_path)

    # ── GPS ping dots ────────────────────────────────────────────────────────
    for i, (lat, lng, t) in enumerate(path_points):
        folium.CircleMarker(
            location=[lat, lng], radius=5,
            color="#B71C1C", fill=True, fill_color="white", fill_opacity=1,
            weight=2, tooltip=f"GPS ping {i+1} | {t}"
        ).add_to(grp_path)

    # ── START marker ─────────────────────────────────────────────────────────
    folium.Marker(
        coords[0],
        popup=folium.Popup(
            f"<b>START</b><br><small>{times[0]}</small>", max_width=200),
        icon=folium.DivIcon(
            html="""<div style="background:#1B5E20;color:white;
                        padding:5px 10px;border-radius:6px;
                        font-weight:bold;font-size:12px;
                        box-shadow:2px 2px 4px rgba(0,0,0,0.4);
                        white-space:nowrap">&#9658; START</div>""",
            icon_size=(80, 28), icon_anchor=(0, 14))
    ).add_to(grp_path)

    # ── END marker ───────────────────────────────────────────────────────────
    folium.Marker(
        coords[-1],
        popup=folium.Popup(
            f"<b>END</b><br><small>{times[-1]}</small>", max_width=200),
        icon=folium.DivIcon(
            html="""<div style="background:#B71C1C;color:white;
                        padding:5px 10px;border-radius:6px;
                        font-weight:bold;font-size:12px;
                        box-shadow:2px 2px 4px rgba(0,0,0,0.4);
                        white-space:nowrap">&#9632; END</div>""",
            icon_size=(70, 28), icon_anchor=(0, 14))
    ).add_to(grp_path)

    # ── Shapely path for proximity (reuse the simplified line) ───────────────
    path_line = simplified

    near_count = far_count = 0

    for store in stores:
        dist = dist_km_to_path(path_line, store["lat"], store["lng"])
        near = dist <= NEAR_PATH_KM
        label = store["name"] or store["id"]

        popup_html = f"""
        <div style="font-family:Arial,sans-serif;min-width:200px;padding:4px">
            <div style="font-size:14px;font-weight:bold;margin-bottom:4px">{label}</div>
            <div style="color:#555;font-size:11px">ID: {store['id']}</div>
            <div style="color:#555;font-size:11px">Orders on {DAY}: <b>{store['order_count']}</b></div>
            <hr style="margin:6px 0">
            <div style="font-size:12px">
                Distance from path:&nbsp;
                <b style="color:{'#E65100' if near else '#616161'}">{dist} km</b>
            </div>
            <div style="font-size:12px;margin-top:2px">
                Status:&nbsp;
                <b style="color:{'#E65100' if near else '#616161'}">
                    {'ON / NEAR PATH' if near else 'Far from path'}
                </b>
            </div>
        </div>
        """

        if near:
            near_count += 1
            # Big bright orange circle
            folium.CircleMarker(
                location=[store["lat"], store["lng"]],
                radius=14, color="#E65100", weight=3,
                fill=True, fill_color="#FF6D00", fill_opacity=0.85,
                popup=folium.Popup(popup_html, max_width=260),
                tooltip=f"STORE: {label}  ({dist} km from path)"
            ).add_to(grp_near)

            # Store name label above the circle
            folium.Marker(
                location=[store["lat"], store["lng"]],
                icon=folium.DivIcon(
                    html=f"""<div style="background:white;
                                border:2px solid #E65100;
                                color:#BF360C;
                                padding:2px 6px;
                                border-radius:4px;
                                font-size:10px;font-weight:bold;
                                white-space:nowrap;
                                box-shadow:1px 1px 3px rgba(0,0,0,0.3);
                                margin-top:-32px">{label[:25]}</div>""",
                    icon_size=(160, 22), icon_anchor=(80, 22)
                ),
                popup=folium.Popup(popup_html, max_width=260),
            ).add_to(grp_near)

        else:
            far_count += 1
            folium.CircleMarker(
                location=[store["lat"], store["lng"]],
                radius=6, color="#78909C", weight=1,
                fill=True, fill_color="#B0BEC5", fill_opacity=0.6,
                popup=folium.Popup(popup_html, max_width=260),
                tooltip=f"{label}  ({dist} km)"
            ).add_to(grp_far)

    grp_path.add_to(m)
    grp_near.add_to(m)
    grp_far.add_to(m)
    folium.LayerControl(collapsed=False, position="topright").add_to(m)

    # ── Legend ────────────────────────────────────────────────────────────────
    legend_html = f"""
    <div style="position:fixed;bottom:30px;left:30px;z-index:9999;
                background:white;padding:14px 18px;border-radius:10px;
                border:2px solid #CFD8DC;font-family:Arial,sans-serif;
                font-size:13px;line-height:2;
                box-shadow:3px 3px 8px rgba(0,0,0,0.2)">
        <div style="font-size:15px;font-weight:bold;margin-bottom:6px">
            Rider Path Map
        </div>
        <div><b>Rider:</b> {RIDER_ID}</div>
        <div><b>Date:</b> {DAY}</div>
        <div><b>GPS pings:</b> {len(path_points)}</div>
        <div><b>Road distance:</b> {road_dist_km:.2f} km</div>
        <div><b>GPS gaps:</b> {sum(1 for _,g in road_segments if g)}</div>
        <hr style="margin:8px 0;border-color:#CFD8DC">
        <div style="display:flex;align-items:center;gap:8px">
            <svg width="30" height="8">
              <line x1="0" y1="4" x2="30" y2="4"
                    stroke="#E53935" stroke-width="4"/>
            </svg>
            Rider path (animated)
        </div>
        <div style="display:flex;align-items:center;gap:8px">
            <span style="display:inline-block;width:14px;height:14px;
                         border-radius:50%;background:#1B5E20"></span>
            Start point
        </div>
        <div style="display:flex;align-items:center;gap:8px">
            <span style="display:inline-block;width:14px;height:14px;
                         border-radius:50%;background:#B71C1C"></span>
            End point
        </div>
        <div style="display:flex;align-items:center;gap:8px">
            <span style="display:inline-block;width:16px;height:16px;
                         border-radius:50%;background:#FF6D00;
                         border:2px solid #E65100"></span>
            Store near path &nbsp;<b>({near_count})</b>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
            <span style="display:inline-block;width:10px;height:10px;
                         border-radius:50%;background:#B0BEC5;
                         border:1px solid #78909C"></span>
            Other stores &nbsp;<b>({far_count})</b>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
            <svg width="30" height="8">
              <line x1="0" y1="4" x2="30" y2="4"
                stroke="#9E9E9E" stroke-width="2" stroke-dasharray="6,4"/>
            </svg>
            GPS gap (app closed)
        </div>
        <div style="font-size:11px;color:#777;margin-top:4px">
            Near = within {NEAR_PATH_KM} km of path
        </div>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))

    return m, near_count, far_count

def main():
    conn = get_connection()
    cur  = conn.cursor()

    print(f"Fetching path for rider {RIDER_ID} on {DAY} ...")
    path_points = fetch_rider_path(cur)
    print(f"  {len(path_points)} location pings found")

    if not path_points:
        print("No location data for this rider on this day.")
        return

    print("Fetching store locations ...")
    stores = fetch_stores(cur)
    print(f"  {len(stores)} stores with coordinates")

    print("Building map ...")
    m, near, far = build_map(path_points, stores)

    output = "rider_map.html"
    m.save(output)
    print(f"Map saved: {output}")
    print(f"  Stores near path   : {near}")
    print(f"  Stores far from path: {far}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
