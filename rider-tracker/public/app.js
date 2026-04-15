import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const socket = window.io({ autoConnect: false });
const LONG_GAP = 45;

const formatTime = value =>
  value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "N/A";

const formatDateTime = value =>
  value
    ? new Date(value).toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "N/A";

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed for ${url}`);
  }
  return data;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clusterItems(items, zoom, type) {
  const threshold = type === "ping" ? 120 : 20;
  if (items.length < threshold || zoom >= (type === "ping" ? 15 : 14)) {
    return { singles: items, clusters: [] };
  }
  const cell = (type === "ping" ? 0.03 : 0.06) / Math.max(1, zoom - 8);
  const buckets = new Map();
  for (const item of items) {
    const key = `${Math.round(item.lat / cell)}:${Math.round(item.lng / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const singles = [];
  const clusters = [];
  for (const group of buckets.values()) {
    if (group.length === 1) {
      singles.push(group[0]);
      continue;
    }
    const center = group.reduce(
      (acc, item) => ({
        lat: acc.lat + item.lat / group.length,
        lng: acc.lng + item.lng / group.length,
      }),
      { lat: 0, lng: 0 }
    );
    clusters.push({ lat: center.lat, lng: center.lng, count: group.length });
  }
  return { singles, clusters };
}

function tooltipMarkup(store) {
  const visitText = store.visited
    ? `Visited at ${escapeHtml(formatTime(store.visitTime))} - dwell ${escapeHtml(store.dwellMinutes)} min`
    : "No backend visit activity detected";
  return `
    <div class="tooltip-card">
      <div class="tooltip-title">${escapeHtml(store.name)}</div>
      <div class="tooltip-meta">${escapeHtml(store.id)} - ${escapeHtml(store.orderCount)} order(s)</div>
      <div class="tooltip-meta">${visitText}</div>
      <div class="tooltip-address">${escapeHtml(store.address || "Address not available")}</div>
    </div>
  `;
}

function MapCanvas({ day, stores, segments, playbackIndex, activeStoreId, onStoreFocus, liveState, loading }) {
  const nodeRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef({ path: [], points: [], clusters: [], playback: [], live: [], markers: new Map() });
  const autoFitKeyRef = useRef("");
  const [zoom, setZoom] = useState(12);

  useEffect(() => {
    if (mapRef.current) return;
    const map = L.map(nodeRef.current, { zoomControl: true }).setView([17.4, 78.4], 12);
    mapRef.current = map;

    const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 20,
    });
    const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    });
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri",
      maxZoom: 19,
    });
    const labels = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 20,
      pane: "overlayPane",
    });

    light.addTo(map);
    labels.addTo(map);
    L.control.layers({ Light: light, Street: street, Satellite: sat }, { "Place Labels": labels }, { collapsed: false }).addTo(map);
    map.on("zoomend", () => setZoom(map.getZoom()));
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const overlay = overlayRef.current;
    for (const key of ["path", "points", "clusters", "playback", "live"]) {
      for (const layer of overlay[key]) map.removeLayer(layer);
      overlay[key] = [];
    }
    overlay.markers = new Map();

    if (!day) return;

    segments.forEach(segment => {
      if (segment.isGap) {
        const gap = L.polyline(segment.coords, {
          color: "#7c8da8",
          weight: 2.5,
          dashArray: "8 7",
          opacity: 0.82,
        }).bindTooltip(`Gap ${segment.gapMin} min`);
        gap.addTo(map);
        overlay.path.push(gap);
      } else {
        const shadow = L.polyline(segment.coords, { color: "#0b1020", weight: 11, opacity: 0.26 });
        const line = L.polyline(segment.coords, { color: "#ff7b7b", weight: 5, opacity: 0.96 }).bindTooltip(`${segment.distKm} km`);
        shadow.addTo(map);
        line.addTo(map);
        overlay.path.push(shadow, line);
      }
    });

    const pingGroups = clusterItems(day.pings, zoom, "ping");
    const storeGroups = clusterItems(stores, zoom, "store");

    pingGroups.singles.forEach(ping => {
      const marker = L.circleMarker([ping.lat, ping.lng], {
        radius: 4,
        color: "#4299e1",
        fillColor: "#fff",
        fillOpacity: 1,
        weight: 2,
      }).bindTooltip(`Ping - ${formatTime(ping.time)}`);
      marker.addTo(map);
      overlay.points.push(marker);
    });

    pingGroups.clusters.forEach(cluster => {
      const marker = L.circleMarker([cluster.lat, cluster.lng], {
        radius: Math.min(28, 10 + cluster.count / 6),
        color: "#5da9ff",
        fillColor: "#2d6cdf",
        fillOpacity: 0.8,
        weight: 2,
      }).bindTooltip(`${cluster.count} pings clustered`);
      marker.addTo(map);
      overlay.clusters.push(marker);
    });

    if (day.pings.length) {
      const first = day.pings[0];
      const last = day.pings.at(-1);
      const start = L.circleMarker([first.lat, first.lng], {
        radius: 10, color: "#38a169", fillColor: "#68d391", fillOpacity: 1, weight: 2,
      }).bindPopup(`<b>START</b><br>${formatTime(first.time)}`);
      const end = L.circleMarker([last.lat, last.lng], {
        radius: 10, color: "#e53e3e", fillColor: "#fc8181", fillOpacity: 1, weight: 2,
      }).bindPopup(`<b>END</b><br>${formatTime(last.time)}`);
      start.addTo(map);
      end.addTo(map);
      overlay.points.push(start, end);
    }

    storeGroups.singles.forEach(store => {
      const marker = L.marker([store.lat, store.lng], {
        icon: storeMarkerIcon(store),
      })
        .bindTooltip(tooltipMarkup(store), { direction: "top", className: "store-tooltip", sticky: true, opacity: 1 })
        .bindPopup(tooltipMarkup(store))
        .on("click", () => onStoreFocus(store.id));
      marker.addTo(map);
      overlay.points.push(marker);
      overlay.markers.set(store.id, marker);
    });

    storeGroups.clusters.forEach(cluster => {
      const marker = L.circleMarker([cluster.lat, cluster.lng], {
        radius: Math.min(26, 10 + cluster.count / 3),
        color: "#f7c873",
        fillColor: "#c57d12",
        fillOpacity: 0.86,
        weight: 2,
      }).bindTooltip(`${cluster.count} stores clustered`);
      marker.addTo(map);
      overlay.clusters.push(marker);
    });

    if (day.pings.length) {
      const idx = Math.max(0, Math.min(playbackIndex, day.pings.length - 1));
      const seen = day.pings.slice(0, idx + 1);
      const trail = L.polyline(seen.map(p => [p.lat, p.lng]), { color: "#9cd8ff", weight: 4, opacity: 0.9 });
      const current = seen.at(-1);
      const playMarker = L.circleMarker([current.lat, current.lng], {
        radius: 9, color: "#fff", fillColor: "#78a7ff", fillOpacity: 1, weight: 2,
      }).bindTooltip(`Playback - ${formatTime(current.time)}`);
      trail.addTo(map);
      playMarker.addTo(map);
      overlay.playback.push(trail, playMarker);
    }

    liveState.segments.forEach(segment => {
      const line = L.polyline(segment.coords, {
        color: segment.fallback ? "#ffd166" : "#67e0af",
        weight: 4,
        opacity: 0.95,
      }).bindTooltip(segment.fallback ? "Live route fallback" : `Live segment ${segment.distKm} km`);
      line.addTo(map);
      overlay.live.push(line);
    });

    if (liveState.pings.length) {
      const latest = liveState.pings.at(-1);
      const marker = L.circleMarker([latest.lat, latest.lng], {
        radius: 10, color: "#67e0af", fillColor: "#67e0af", fillOpacity: 1, weight: 2,
      }).bindTooltip(`Live location - ${formatTime(latest.time)}`);
      marker.addTo(map);
      overlay.live.push(marker);
    }

  }, [day, stores, segments, zoom, playbackIndex, activeStoreId, onStoreFocus, liveState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !day) return;

    const bounds = [];
    day.pings.forEach(point => bounds.push([point.lat, point.lng]));
    stores.forEach(store => bounds.push([store.lat, store.lng]));
    if (!bounds.length) return;

    const fitKey = JSON.stringify({
      riderId: day.riderId,
      date: day.date,
      pingCount: day.pings.length,
      storeIds: stores.map(store => store.id),
    });

    if (autoFitKeyRef.current === fitKey) return;
    autoFitKeyRef.current = fitKey;
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [day, stores]);

  useEffect(() => {
    const marker = overlayRef.current.markers.get(activeStoreId);
    const map = mapRef.current;
    if (!marker || !map) return;
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16));
    marker.openTooltip();
  }, [activeStoreId]);

  return html`
    <div className="map-stage">
      <div className="map-header">
        <div>
          <div className="eyebrow">Route Map</div>
          <h2>${day?.riderName || "Rider overview"}</h2>
        </div>
        <div className="chip-row">
          <div className="chip"><strong>${day?.summary?.totalPingCount ?? 0}</strong> pings</div>
          <div className="chip"><strong>${day?.summary?.routeDistanceKm ?? 0} km</strong> routed</div>
          <div className="chip"><strong>${day?.anomalies?.length ?? 0}</strong> anomalies</div>
        </div>
      </div>
      ${loading && html`<div className="loading-overlay"><div className="loading-card"><div className="spinner"></div><div>Loading rider intelligence...</div></div></div>`}
      <div ref=${nodeRef} className="map"></div>
    </div>
  `;
}

function App() {
  const [authState, setAuthState] = useState({ ready: false, enabled: false, authenticated: false, username: null });
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginPending, setLoginPending] = useState(false);
  const [riders, setRiders] = useState([]);
  const [dates, setDates] = useState([]);
  const [selectedRiderId, setSelectedRiderId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [day, setDay] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ text: "Choose a rider and date to load the dashboard.", error: false });
  const [riderQuery, setRiderQuery] = useState("");
  const [storeQuery, setStoreQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [gapFilter, setGapFilter] = useState("all");
  const [highDistanceOnly, setHighDistanceOnly] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [activeStoreId, setActiveStoreId] = useState("");
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [liveState, setLiveState] = useState({ pings: [], segments: [] });
  const loadDayAbortRef = useRef(null);

  const filteredRiders = useMemo(() => {
    const query = riderQuery.trim().toLowerCase();
    return riders.filter(rider => `${rider.name} ${rider.id}`.toLowerCase().includes(query));
  }, [riders, riderQuery]);

  const filteredDates = useMemo(
    () => dates.filter(item => !highDistanceOnly || item.highDistance),
    [dates, highDistanceOnly]
  );

  const selectedRider = useMemo(
    () => riders.find(rider => rider.id === selectedRiderId) || null,
    [riders, selectedRiderId]
  );

  const selectedDateMeta = useMemo(
    () => filteredDates.find(item => item.day === selectedDate) || null,
    [filteredDates, selectedDate]
  );

  const filteredStores = useMemo(() => {
    if (!day) return [];
    const query = storeQuery.trim().toLowerCase();
    return day.stores.filter(store => {
      const queryOk = `${store.name} ${store.id}`.toLowerCase().includes(query);
      const statusOk =
        storeFilter === "all" ||
        (storeFilter === "visited" && store.visited) ||
        (storeFilter === "missed" && !store.visited);
      return queryOk && statusOk;
    });
  }, [day, storeQuery, storeFilter]);

  const visibleSegments = useMemo(() => {
    if (!day) return [];
    return gapFilter === "long"
      ? day.segments.filter(segment => segment.isGap && segment.gapMin >= LONG_GAP)
      : day.segments;
  }, [day, gapFilter]);

  const summaryItems = useMemo(() => {
    if (!day?.summary) return [];
    const s = day.summary;
    return [
      ["First Ping", formatDateTime(s.firstPing), `${s.totalPingCount} total pings`],
      ["Last Ping", formatDateTime(s.lastPing), `${s.totalSpanMinutes} min total span`],
      ["Route Distance", `${s.routeDistanceKm} km`, `${s.straightDistanceKm} km straight line`],
      ["Stores Covered", `${s.storesCovered}/${s.storesAssigned}`, `${s.storesMissed} missed stores`],
      ["Idle Time", `${s.idleMinutes} min`, `${s.longGapCount} long gaps`],
      ["Avg Stop", `${s.averageStopDurationMinutes} min`, `${s.totalDwellMinutes} min total dwell`],
      ["Anomalies", `${day.anomalies.length}`, "Detected issues"],
    ];
  }, [day]);

  const spotlightStats = useMemo(() => {
    if (!day?.summary) {
      return [
        ["Coverage", "0/0", "Stores reached"],
        ["Route", "0 km", "Travelled distance"],
        ["Gaps", "0", "Long interruptions"],
      ];
    }

    return [
      ["Coverage", `${day.summary.storesCovered}/${day.summary.storesAssigned}`, "Stores reached"],
      ["Route", `${day.summary.routeDistanceKm} km`, "Travelled distance"],
      ["Gaps", `${day.summary.longGapCount}`, "Long interruptions"],
    ];
  }, [day]);

  const canAccessDashboard = !authState.enabled || authState.authenticated;

  useEffect(() => {
    let mounted = true;
    requestJson("/api/auth/status")
      .then(data => {
        if (!mounted) return;
        setAuthState({
          ready: true,
          enabled: Boolean(data.authEnabled),
          authenticated: Boolean(data.authenticated),
          username: data.username || null,
        });
      })
      .catch(error => {
        if (!mounted) return;
        setAuthState({ ready: true, enabled: false, authenticated: true, username: null });
        setStatus({ text: error.message, error: true });
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authState.ready || !canAccessDashboard) return;
    const controller = new AbortController();
    setLoading(true);
    requestJson("/api/riders", { signal: controller.signal })
      .then(data => {
        setRiders(data);
        if (data.length) setSelectedRiderId(data[0].id);
      })
      .catch(error => {
        if (error.name === "AbortError") return;
        setStatus({ text: error.message, error: true });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [authState.ready, canAccessDashboard]);

  useEffect(() => {
    if (!canAccessDashboard) return;
    if (!selectedRiderId) {
      setDates([]);
      setSelectedDate("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setIsStoreModalOpen(false);
    requestJson(`/api/riders/${encodeURIComponent(selectedRiderId)}/dates`, { signal: controller.signal })
      .then(data => {
        setDates(data);
        setSelectedDate(current => (current && data.some(item => item.day === current) ? current : data[0]?.day || ""));
      })
      .catch(error => {
        if (error.name === "AbortError") return;
        setStatus({ text: error.message, error: true });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [selectedRiderId, canAccessDashboard]);

  useEffect(() => () => {
    loadDayAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!isPlaying || !day?.pings?.length) return;
    const timer = window.setInterval(() => {
      setPlaybackIndex(index => {
        if (index >= day.pings.length - 1) {
          setIsPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [isPlaying, day]);

  useEffect(() => {
    if (!authState.ready) return;
    if (canAccessDashboard) {
      if (!socket.connected) socket.connect();
      return;
    }
    if (socket.connected) socket.disconnect();
  }, [authState.ready, canAccessDashboard]);

  useEffect(() => {
    const onSnapshot = payload => setLiveState({ pings: payload?.pings || [], segments: [] });
    const onNewPings = payload =>
      setLiveState(current => ({
        pings: [...current.pings, ...(payload?.pings || [])].slice(-120),
        segments: [...current.segments, ...(payload?.routeSegments || [])].slice(-80),
      }));
    socket.on("live_snapshot", onSnapshot);
    socket.on("new_pings", onNewPings);
    return () => {
      socket.off("live_snapshot", onSnapshot);
      socket.off("new_pings", onNewPings);
    };
  }, []);

  useEffect(() => {
    if (!canAccessDashboard) return;
    if (!selectedRiderId) return;
    if (isLive) socket.emit("subscribe_live", { riderId: selectedRiderId });
    else socket.emit("unsubscribe_live");
  }, [isLive, selectedRiderId, canAccessDashboard]);

  async function loadDay() {
    if (!selectedRiderId || !selectedDate) {
      setStatus({ text: "Select a rider and a date first.", error: true });
      return;
    }
    loadDayAbortRef.current?.abort();
    const controller = new AbortController();
    loadDayAbortRef.current = controller;
    setLoading(true);
    try {
      const data = await requestJson(`/api/riders/${encodeURIComponent(selectedRiderId)}/day/${selectedDate}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setDay(data);
      setPlaybackIndex(0);
      setActiveStoreId("");
      setIsStoreModalOpen(false);
      setStatus({ text: `Loaded ${data.riderName} on ${selectedDate}. ${data.summary.storesCovered}/${data.summary.storesAssigned} stores covered.`, error: false });
    } catch (error) {
      if (error.name === "AbortError") return;
      setStatus({ text: error.message, error: true });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (loadDayAbortRef.current === controller) loadDayAbortRef.current = null;
    }
  }

  function toggleLive() {
    if (!selectedRiderId) {
      setStatus({ text: "Select a rider before enabling live tracking.", error: true });
      return;
    }
    setIsLive(value => !value);
    setStatus({ text: isLive ? "Live tracking stopped." : "Live tracking enabled. New pings will append to the map.", error: false });
  }

  function exportReport(format) {
    if (!selectedRiderId || !selectedDate) {
      setStatus({ text: "Load a rider-day before exporting.", error: true });
      return;
    }
    window.open(`/api/riders/${encodeURIComponent(selectedRiderId)}/export/${selectedDate}.${format}`, "_blank");
  }

  function openStoreModal() {
    if (!day) {
      setStatus({ text: "Load a rider-day before opening store coverage.", error: true });
      return;
    }
    setIsStoreModalOpen(true);
  }

  async function submitLogin(event) {
    event.preventDefault();
    setLoginPending(true);
    try {
      const data = await requestJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      setAuthState({
        ready: true,
        enabled: true,
        authenticated: true,
        username: data.username || loginForm.username,
      });
      setStatus({ text: "Signed in successfully.", error: false });
      setLoginForm({ username: "", password: "" });
    } catch (error) {
      setStatus({ text: error.message, error: true });
    } finally {
      setLoginPending(false);
    }
  }

  async function logout() {
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
    } catch {
      // best effort logout
    }
    socket.disconnect();
    setAuthState(current => ({ ...current, authenticated: false, username: null }));
    setDay(null);
    setDates([]);
    setRiders([]);
    setSelectedDate("");
    setSelectedRiderId("");
    setIsLive(false);
    setStatus({ text: "Signed out.", error: false });
  }

  if (!authState.ready) {
    return html`
      <div className="auth-shell">
        <div className="auth-card auth-card-loading">
          <div className="eyebrow">Rider Tracker</div>
          <h1>Preparing secure workspace</h1>
          <p>Checking your access before loading the dashboard.</p>
        </div>
      </div>
    `;
  }

  if (authState.enabled && !authState.authenticated) {
    return html`
      <div className="auth-shell">
        <div className="auth-card">
          <div className="eyebrow">Secure Login</div>
          <h1>Rider Tracker</h1>
          <p>Sign in to access rider routes, anomalies, live tracking, and store coverage.</p>
          <form className="auth-form" onSubmit=${submitLogin}>
            <label className="field">
              <span>Username</span>
              <input className="input" value=${loginForm.username} onInput=${e => setLoginForm(current => ({ ...current, username: e.target.value }))} autoComplete="username" />
            </label>
            <label className="field">
              <span>Password</span>
              <input className="input" type="password" value=${loginForm.password} onInput=${e => setLoginForm(current => ({ ...current, password: e.target.value }))} autoComplete="current-password" />
            </label>
            <button className="button button-primary auth-submit" disabled=${loginPending}>${loginPending ? "Signing In..." : "Sign In"}</button>
          </form>
          <div className=${`status auth-status ${status.error ? "error" : ""}`}>${status.text}</div>
        </div>
      </div>
    `;
  }

  return html`
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="eyebrow">React Upgrade</div>
          <h1>Rider Path Tracker</h1>
          <p>React-driven controls, cleaner state flow, and a more intentional UX around playback, store coverage, exports, and live rider movement.</p>
          ${authState.enabled ? html`
            <div className="auth-chip-row">
              <div className="auth-chip">Signed in as <strong>${authState.username || "user"}</strong></div>
              <button className="button button-ghost auth-logout" onClick=${logout}>Logout</button>
            </div>
          ` : null}
          <div className="spotlight-strip">
            ${spotlightStats.map(([label, value, meta]) => html`
              <div key=${label} className="spotlight-card">
                <div className="spotlight-label">${label}</div>
                <div className="spotlight-value">${value}</div>
                <div className="spotlight-meta">${meta}</div>
              </div>
            `)}
          </div>
        </div>
        <div className="sidebar-body">
          <section className="panel">
            <h3 className="panel-title">Explorer</h3>
            <div className="field">
              <label>Search Rider</label>
              <input className="input" value=${riderQuery} onInput=${e => setRiderQuery(e.target.value)} placeholder="Type rider name or id" />
            </div>
            <div className="field">
              <label>Rider</label>
              <div className="select-shell">
                <select className="select" value=${selectedRiderId} onChange=${e => setSelectedRiderId(e.target.value)}>
                  ${filteredRiders.length
                    ? filteredRiders.map(rider => html`<option key=${rider.id} value=${rider.id}>${rider.name} (${rider.id})</option>`)
                    : html`<option value="">No riders found</option>`}
                </select>
              </div>
              <div className="field-note">${selectedRider ? `${selectedRider.name} - ID ${selectedRider.id}` : "Select a rider to load available dates."}</div>
            </div>
            <div className="grid-two">
              <div className="field">
                <label>Date</label>
                <div className="select-shell">
                  <select className="select" value=${selectedDate} onChange=${e => setSelectedDate(e.target.value)}>
                    ${filteredDates.length
                      ? filteredDates.map(item => html`<option key=${item.day} value=${item.day}>${item.day}</option>`)
                      : html`<option value="">No matching days</option>`}
                  </select>
                </div>
                <div className="field-note">${selectedDateMeta ? `${selectedDateMeta.approxKm} km estimated route - ${selectedDateMeta.pings} pings` : "Pick a day to see route and store details."}</div>
              </div>
              <div className="field">
                <label>Store Search</label>
                <input className="input" value=${storeQuery} onInput=${e => setStoreQuery(e.target.value)} placeholder="Store name or id" />
              </div>
            </div>
            <label className="toggle"><input type="checkbox" checked=${highDistanceOnly} onChange=${e => setHighDistanceOnly(e.target.checked)} />High-distance days only</label>
            <div className="button-row" style=${{ marginTop: "12px" }}>
              <button className="button button-primary" onClick=${loadDay}>Load Day</button>
              <button className=${`button button-secondary ${isLive ? "active" : ""}`} onClick=${toggleLive}>${isLive ? "Disable Live Tracking" : "Enable Live Tracking"}</button>
            </div>
            <div className="button-row" style=${{ marginTop: "10px" }}>
              <button className="button button-ghost" onClick=${() => exportReport("csv")}>Export CSV</button>
              <button className="button button-ghost" onClick=${() => exportReport("pdf")}>Export PDF</button>
            </div>
            <div className=${`status ${status.error ? "error" : ""}`}>${status.text}</div>
          </section>

          <section className="panel">
            <h3 className="panel-title">Filters</h3>
            <div className="grid-two">
              <div className="field">
                <label>Store Status</label>
                <select className="select" value=${storeFilter} onChange=${e => setStoreFilter(e.target.value)}>
                  <option value="all">All stores</option>
                  <option value="visited">Only visited</option>
                  <option value="missed">Only missed</option>
                </select>
              </div>
              <div className="field">
                <label>Gap Filter</label>
                <select className="select" value=${gapFilter} onChange=${e => setGapFilter(e.target.value)}>
                  <option value="all">All route segments</option>
                  <option value="long">Only long gaps</option>
                </select>
              </div>
            </div>
            <div className="helper">Use filters to isolate missed stores, long app-off gaps, and dense rider days without leaving the main dashboard.</div>
          </section>

          <section className="panel">
            <h3 className="panel-title">Playback</h3>
            <div className="playback-row">
              <button className="button button-ghost button-small" onClick=${() => setIsPlaying(value => !value)} disabled=${!day?.pings?.length}>${isPlaying ? "Pause" : "Play"}</button>
              <span>${day?.pings?.length ? `${formatTime(day.pings[Math.min(playbackIndex, day.pings.length - 1)]?.time)} - ${Math.min(playbackIndex + 1, day.pings.length)}/${day.pings.length}` : "No playback loaded"}</span>
            </div>
            <input className="range" type="range" min="0" max=${Math.max(0, (day?.pings?.length || 1) - 1)} value=${Math.min(playbackIndex, Math.max(0, (day?.pings?.length || 1) - 1))} onInput=${e => { setIsPlaying(false); setPlaybackIndex(Number(e.target.value)); }} />
            <div className="helper">Replay the rider day point by point and watch the travelled line build over time.</div>
          </section>

        </div>
      </aside>

      <main className="workspace">
        ${summaryItems.length ? html`
          <section className="workspace-panel overview-panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Overview</div>
                <h2>Key rider-day signals</h2>
              </div>
              <p>${day ? `${day.riderName} on ${selectedDate}` : "Load a rider-day to populate the dashboard."}</p>
            </div>
            <div className="summary-grid summary-grid-wide">
              ${summaryItems.map(([label, value, meta]) => html`<div key=${label} className="summary-card"><div className="summary-label">${label}</div><div className="summary-value">${value}</div><div className="summary-meta">${meta}</div></div>`)}
            </div>
          </section>
        ` : html`
          <section className="workspace-panel overview-panel empty-overview">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Overview</div>
                <h2>Load a rider-day to open the dashboard</h2>
              </div>
              <p>The map, summary cards, anomaly review, and store coverage will all appear here in one glance.</p>
            </div>
          </section>
        `}

        <div className="workspace-grid">
          <section className="workspace-panel map-panel">
            <${MapCanvas}
              day=${day}
              stores=${filteredStores}
              segments=${visibleSegments}
              playbackIndex=${playbackIndex}
              activeStoreId=${activeStoreId}
              onStoreFocus=${setActiveStoreId}
              liveState=${liveState}
              loading=${loading}
            />
          </section>

          <section className="detail-rail">
            ${day ? html`
              <section className="workspace-panel compact-panel">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">Exceptions</div>
                    <h2>Detected anomalies</h2>
                  </div>
                  <p>${day.anomalies.length ? `${day.anomalies.length} items need review` : "No anomalies detected."}</p>
                </div>
                <div className="list rail-list">
                  ${day.anomalies.length ? day.anomalies.map(item => html`<div key=${`${item.type}-${item.label}`} className=${`anomaly-card ${item.severity === "high" ? "high" : ""}`}><div className="anomaly-title">${item.label}</div><div className="anomaly-text">${item.details}</div></div>`) : html`<div className="empty">No anomalies detected for this rider-day.</div>`}
                </div>
              </section>

              <section className="workspace-panel compact-panel">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">Store Coverage</div>
                    <h2>Coverage snapshot</h2>
                  </div>
                  <p>${day.summary.storesCovered}/${day.summary.storesAssigned} stores covered. Open the full list in a focused view.</p>
                </div>
                <div className="coverage-card">
                  <div className="coverage-metrics">
                    <div className="coverage-metric">
                      <div className="coverage-label">Visible Stores</div>
                      <div className="coverage-value">${filteredStores.length}</div>
                    </div>
                    <div className="coverage-metric">
                      <div className="coverage-label">Visited</div>
                      <div className="coverage-value">${filteredStores.filter(store => store.visited).length}</div>
                    </div>
                    <div className="coverage-metric">
                      <div className="coverage-label">Missed</div>
                      <div className="coverage-value">${filteredStores.filter(store => !store.visited).length}</div>
                    </div>
                  </div>
                  <button className="button button-primary coverage-button" onClick=${openStoreModal}>Open Store Coverage</button>
                  <div className="helper">The modal keeps the main dashboard cleaner while still letting you review and click through every store.</div>
                </div>
              </section>
            ` : html`
              <section className="workspace-panel compact-panel empty-state-panel">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">Workspace</div>
                    <h2>Details will land here</h2>
                  </div>
                  <p>Load a rider-day to see the map, anomaly list, and store coverage without scrolling deep into the page.</p>
                </div>
              </section>
            `}
          </section>
        </div>
      </main>

      ${isStoreModalOpen && day ? html`
        <div className="modal-backdrop" onClick=${() => setIsStoreModalOpen(false)}>
          <div className="modal-shell" onClick=${e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="eyebrow">Store Coverage</div>
                <h2>${day.riderName} - ${selectedDate}</h2>
                <p>${filteredStores.length} stores shown with current filters. Click a store to focus it on the map.</p>
              </div>
              <button className="modal-close" onClick=${() => setIsStoreModalOpen(false)} aria-label="Close store coverage">Close</button>
            </div>
            <div className="modal-body">
              <div className="modal-metrics">
                <div className="coverage-metric">
                  <div className="coverage-label">Visible Stores</div>
                  <div className="coverage-value">${filteredStores.length}</div>
                </div>
                <div className="coverage-metric">
                  <div className="coverage-label">Visited</div>
                  <div className="coverage-value">${filteredStores.filter(store => store.visited).length}</div>
                </div>
                <div className="coverage-metric">
                  <div className="coverage-label">Missed</div>
                  <div className="coverage-value">${filteredStores.filter(store => !store.visited).length}</div>
                </div>
              </div>
              <div className="modal-list">
                ${filteredStores.length ? filteredStores.map(store => html`
                  <div key=${store.id} className=${`store-card ${activeStoreId === store.id ? "active" : ""}`} onMouseEnter=${() => setActiveStoreId(store.id)} onClick=${() => { setActiveStoreId(store.id); setIsStoreModalOpen(false); }}>
                    <div className="store-top">
                      <div className="store-name">${store.name}</div>
                      <div className=${`pill ${store.visited ? "gold" : "muted"}`}>${store.visited ? formatDateTime(store.visitTime) : "Missed"}</div>
                    </div>
                    <div className="store-meta">${store.id} - ${store.orderCount} order(s) - dwell ${store.dwellMinutes} min</div>
                    <div className="store-address">${store.address || "Address not available"}</div>
                  </div>
                `) : html`<div className="empty">No stores match the current filters.</div>`}
              </div>
            </div>
          </div>
        </div>
      ` : null}
    </div>
  `;
}

function storeMarkerIcon(store) {
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
    html: `
      <div class="store-marker ${store.visited ? "visited" : "missed"}" aria-label="Store ${escapeHtml(store.name)}">
        <span class="store-marker-glyph">⌂</span>
      </div>
    `,
  });
}

createRoot(document.getElementById("root")).render(html`<${App} />`);

