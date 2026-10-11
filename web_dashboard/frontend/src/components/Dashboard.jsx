import React, { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";

const API_BASE = "http://localhost:3001";

// ── Helpers ───────────────────────────────────────────────────────────────────
function getClassKey(classification) {
  if (!classification) return "mining-truck";
  const c = classification.toLowerCase();
  if (c.includes("empty")) return "empty-load";
  if (c.includes("overload")) return "overloaded";
  if (c.includes("full")) return "full-load";
  return "mining-truck";
}

function getClassIcon(classification) {
  const k = getClassKey(classification);
  if (k === "empty-load") return "🟢";
  if (k === "full-load") return "🟡";
  if (k === "overloaded") return "🚨";
  return "🚛";
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour12: false });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { hour12: false });
}

function formatBytes(bytes) {
  if (!bytes) return "—";
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + " MB";
  return (bytes / 1024).toFixed(1) + " KB";
}

// ── Shared Components ─────────────────────────────────────────────────────────
function StatCard({ icon, value, label, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function ConfidenceBar({ confidence, classKey }) {
  return (
    <div className="conf-row">
      <div className="conf-label">
        <span>Confidence</span>
        <span className="conf-pct">{((confidence || 0) * 100).toFixed(1)}%</span>
      </div>
      <div className="conf-track">
        <div className={`conf-fill ${classKey}`} style={{ width: `${(confidence || 0) * 100}%` }} />
      </div>
    </div>
  );
}

function ClassificationBig({ classification, classKey }) {
  const icons = { "mining-truck": "🚛", "empty-load": "📭", "full-load": "⛏️", "overloaded": "🚨" };
  return (
    <div className={`big-result ${classKey}`}>
      <div className="big-result-icon">{icons[classKey] || "🚛"}</div>
      <div className={`big-result-label ${classKey}`}>{classification || "Waiting…"}</div>
    </div>
  );
}

function HistoryItem({ item, onClick }) {
  const classKey = getClassKey(item.classification);
  return (
    <div className="history-item" onClick={() => onClick(item)} role="button" tabIndex={0}>
      {item.imageUrl ? (
        <img src={item.imageUrl} alt={item.filename} className="history-thumb" />
      ) : (
        <div className="history-thumb" style={{ background: "#1e2a3a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📷</div>
      )}
      <div className="history-info">
        <div className="history-name">{item.filename}</div>
        <div className="history-time">{formatTime(item.timestamp)}</div>
      </div>
      <span className={`history-badge ${classKey}`}>{item.classification}</span>
    </div>
  );
}

// ── Image Gallery ─────────────────────────────────────────────────────────────
function ImageLightbox({ image, onClose }) {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const url = image.signedUrl || image.publicUrl;
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-modal" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose}>✕</button>
        <div className="lightbox-body">
          <div className="lightbox-img-wrap">
            <img src={url} alt={image.name} className="lightbox-img" />
          </div>
          <div className="lightbox-meta">
            <div className="lightbox-meta-title">📄 File Details</div>
            <div className="meta-row"><span className="meta-key">Filename</span><span className="meta-val">{image.name}</span></div>
            <div className="meta-row"><span className="meta-key">Size</span><span className="meta-val">{formatBytes(image.size)}</span></div>
            <div className="meta-row"><span className="meta-key">Type</span><span className="meta-val">{image.mimeType || "—"}</span></div>
            <div className="meta-row"><span className="meta-key">Uploaded</span><span className="meta-val">{formatDateTime(image.createdAt)}</span></div>
            <a href={url} target="_blank" rel="noopener noreferrer" className="lightbox-download">⬇ Open Full Image</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function GalleryCard({ image, onClick }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const url = image.signedUrl || image.publicUrl;
  return (
    <div className="gallery-card" onClick={() => onClick(image)}>
      <div className="gallery-thumb-wrap">
        {!loaded && !errored && <div className="gallery-skeleton" />}
        {errored ? (
          <div className="gallery-error-img">🖼️</div>
        ) : (
          <img src={url} alt={image.name} className="gallery-thumb" style={{ opacity: loaded ? 1 : 0 }}
            onLoad={() => setLoaded(true)} onError={() => { setLoaded(true); setErrored(true); }} />
        )}
        <div className="gallery-overlay"><span className="gallery-expand-icon">🔍</span></div>
      </div>
      <div className="gallery-card-info">
        <div className="gallery-card-name" title={image.name}>{image.name}</div>
        <div className="gallery-card-meta">
          <span>{formatBytes(image.size)}</span>
          <span>{formatDateTime(image.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function BucketGallery() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  const fetchImages = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await axios.get(`${API_BASE}/api/bucket-images?limit=200`);
      setImages(data.images || []);
      setLastFetch(new Date());
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to load images");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  const filtered = images.filter((img) => img.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="gallery-view">
      <div className="gallery-toolbar">
        <div className="gallery-toolbar-left">
          <div className="gallery-search-wrap">
            <span className="gallery-search-icon">🔍</span>
            <input className="gallery-search" type="text" placeholder="Search images…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && <button className="gallery-search-clear" onClick={() => setSearch("")}>✕</button>}
          </div>
          <div className="gallery-count-badge">
            {loading ? "Loading…" : `${filtered.length} / ${images.length} images`}
          </div>
        </div>
        <div className="gallery-toolbar-right">
          {lastFetch && <span className="gallery-last-fetch">Updated {formatTime(lastFetch.toISOString())}</span>}
          <button className="btn-refresh" onClick={fetchImages} disabled={loading}>
            {loading ? "⏳ Loading…" : "🔄 Refresh"}
          </button>
        </div>
      </div>
      {error && <div className="error-banner"><span className="error-icon">⚠️</span><div className="error-text"><strong>Gallery Error:</strong> {error}</div></div>}
      {loading && images.length === 0 && (
        <div className="gallery-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="gallery-card">
              <div className="gallery-thumb-wrap"><div className="gallery-skeleton" /></div>
              <div className="gallery-card-info">
                <div className="gallery-skel-line" style={{ width: "70%" }} />
                <div className="gallery-skel-line" style={{ width: "45%", marginTop: 4 }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && images.length === 0 && !error && (
        <div className="empty-state" style={{ padding: "80px 20px" }}>
          <div className="empty-icon">🗂️</div>
          <div className="empty-title">No images in bucket</div>
          <div className="empty-desc">Upload images to your Supabase <code style={{ color: "#94a3b8" }}>truck-images</code> bucket to see them here.</div>
        </div>
      )}
      {!loading && images.length > 0 && filtered.length === 0 && (
        <div className="empty-state" style={{ padding: "60px 20px" }}>
          <div className="empty-icon" style={{ fontSize: 40 }}>🔍</div>
          <div className="empty-title">No matches for "{search}"</div>
          <div className="empty-desc">Try a different search term.</div>
        </div>
      )}
      {filtered.length > 0 && (
        <div className="gallery-grid">
          {filtered.map((img) => <GalleryCard key={img.id || img.name} image={img} onClick={setSelected} />)}
        </div>
      )}
      {selected && <ImageLightbox image={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Detection Logs View ───────────────────────────────────────────────────────
function DetectionLogs({ history }) {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all" ? history : history.filter(d => getClassKey(d.classification) === filter);

  const badgeColors = {
    "mining-truck": { bg: "rgba(139,92,246,0.15)", border: "rgba(139,92,246,0.5)", color: "#c4b5fd" },
    "empty-load":   { bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.5)", color: "#6ee7b7" },
    "full-load":    { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.5)", color: "#fcd34d" },
    "overloaded":   { bg: "rgba(239,68,68,0.15)",  border: "rgba(239,68,68,0.5)",  color: "#fca5a5" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {["all", "mining-truck", "empty-load", "full-load", "overloaded"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: "6px 14px", borderRadius: 20, border: "1px solid",
              borderColor: filter === f ? "var(--accent-blue)" : "var(--border-subtle)",
              background: filter === f ? "var(--accent-blue)" : "transparent",
              color: filter === f ? "#fff" : "var(--text-muted)",
              cursor: "pointer", fontSize: 12, fontWeight: 600, textTransform: "capitalize",
              transition: "all 0.2s"
            }}>
            {f === "all" ? "All" : f.replace("-", " ")}
          </button>
        ))}
        <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 13, display: "flex", alignItems: "center" }}>
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Log Table */}
      <div className="glass-panel" style={{ overflow: "hidden", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              {["#", "Timestamp", "Filename", "Classification", "Confidence", "Raw Class"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-muted)" }}>No detections logged yet.</td></tr>
            ) : (
              filtered.map((item, i) => {
                const ck = getClassKey(item.classification);
                const bc = badgeColors[ck] || badgeColors["mining-truck"];
                return (
                  <tr key={item.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "12px 16px", color: "var(--text-muted)", fontFamily: "monospace" }}>{filtered.length - i}</td>
                    <td style={{ padding: "12px 16px", color: "var(--text-secondary)", fontFamily: "monospace", whiteSpace: "nowrap" }}>{formatDateTime(item.timestamp)}</td>
                    <td style={{ padding: "12px 16px", color: "var(--text-primary)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.filename}>{item.filename}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ padding: "4px 10px", borderRadius: 999, border: `1px solid ${bc.border}`, background: bc.bg, color: bc.color, fontSize: 11, fontWeight: 700 }}>
                        {getClassIcon(item.classification)} {item.classification}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--text-secondary)", fontFamily: "monospace" }}>{((item.confidence || 0) * 100).toFixed(1)}%</td>
                    <td style={{ padding: "12px 16px", color: "var(--text-muted)", fontFamily: "monospace" }}>{item.raw_class || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Sidebar Nav Item ──────────────────────────────────────────────────────────
function NavItem({ icon, label, id, active, onClick }) {
  return (
    <button
      id={`nav-${id}`}
      onClick={() => onClick(id)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        width: "100%", padding: "11px 16px", borderRadius: 10,
        border: "none", cursor: "pointer", textAlign: "left",
        background: active ? "rgba(234,179,8,0.12)" : "transparent",
        color: active ? "#eab308" : "var(--text-muted)",
        borderLeft: active ? "3px solid #eab308" : "3px solid transparent",
        fontSize: 14, fontWeight: active ? 700 : 500,
        transition: "all 0.18s", fontFamily: "Inter, sans-serif",
      }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "var(--text-secondary)"; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; } }}
    >
      <span style={{ fontSize: 16, width: 22, textAlign: "center" }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ session, supabase }) {
  const [activeTab, setActiveTab]         = useState("monitor");
  const [status, setStatus]               = useState({ isPolling: false, pollingError: null, totalDetections: 0 });
  const [latest, setLatest]               = useState(null);
  const [history, setHistory]             = useState([]);
  const [triggering, setTriggering]       = useState(false);
  const [triggerMsg, setTriggerMsg]       = useState(null);
  const [connected, setConnected]         = useState(false);
  const [imageKey, setImageKey]           = useState(0);
  const [viewDetection, setViewDetection] = useState(null);
  const sseRef = useRef(null);

  // ── SSE ──────────────────────────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const sse = new EventSource(`${API_BASE}/api/stream`);
    sseRef.current = sse;
    sse.addEventListener("connected", () => setConnected(true));
    sse.addEventListener("new_detection", (e) => {
      try {
        const det = JSON.parse(e.data);
        setLatest(det);
        setViewDetection(null);
        setImageKey((k) => k + 1);
        setHistory((prev) => {
          const exists = prev.find((h) => h.id === det.id);
          if (exists) return prev;
          return [det, ...prev].slice(0, 50);
        });
      } catch {}
    });
    sse.addEventListener("status_update", (e) => {
      try { setStatus(JSON.parse(e.data)); } catch {}
    });
    sse.onerror = () => {
      setConnected(false);
      sse.close();
      setTimeout(connectSSE, 3000);
    };
  }, []);

  useEffect(() => {
    connectSSE();
    axios.get(`${API_BASE}/api/history?limit=50`).then((r) => setHistory(r.data.history || [])).catch(() => {});
    axios.get(`${API_BASE}/api/latest`).then((r) => { if (r.data.detection) setLatest(r.data.detection); }).catch(() => {});
    axios.get(`${API_BASE}/health`).then((r) => setStatus({ isPolling: r.data.isPolling, pollingError: r.data.pollingError, totalDetections: r.data.totalDetections })).catch(() => {});
    return () => { if (sseRef.current) sseRef.current.close(); };
  }, [connectSSE]);

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      await axios.post(`${API_BASE}/api/trigger`);
      setTriggerMsg({ type: "success", text: "Scan triggered! Waiting for detection…" });
    } catch (err) {
      setTriggerMsg({ type: "error", text: err.response?.data?.error || "Trigger failed." });
    } finally {
      setTimeout(() => { setTriggering(false); setTriggerMsg(null); }, 4000);
    }
  };

  const displayed = viewDetection || latest;
  const classKey  = getClassKey(displayed?.classification);

  const counts = history.reduce(
    (acc, d) => { const k = getClassKey(d.classification); acc[k] = (acc[k] || 0) + 1; return acc; },
    { "mining-truck": 0, "empty-load": 0, "full-load": 0, "overloaded": 0 }
  );
  const avgConf = history.length
    ? (history.reduce((s, d) => s + (d.confidence || 0), 0) / history.length * 100).toFixed(1) : "—";

  const navItems = [
    { icon: "🏠", label: "Dashboard",      id: "dashboard" },
    { icon: "📡", label: "Live Monitor",   id: "monitor"   },
    { icon: "🖼️", label: "Image Gallery",  id: "gallery"   },
    // { icon: "⚡", label: "Force Scan",     id: "scan"      },
    { icon: "📋", label: "Detection Logs", id: "logs"      },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: 240, height: "100vh", display: "flex", flexDirection: "column",
        background: "var(--bg-secondary)", borderRight: "1px solid var(--border-subtle)",
        position: "fixed", top: 0, left: 0, zIndex: 100, overflowY: "auto", flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, background: "linear-gradient(135deg, #eab308, #d97706)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🚛</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: "#fff", lineHeight: 1.2 }}>TruckVision</div>
              <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase" }}>OVER HAUL PREDICTION</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          {navItems.map(item => (
            <NavItem key={item.id} {...item} active={activeTab === item.id} onClick={setActiveTab} />
          ))}
        </nav>

        {/* Status */}
        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div className={`live-dot ${!connected ? "offline" : status.pollingError ? "error" : ""}`} />
            <span style={{ fontSize: 12, color: connected ? "#10b981" : "#94a3b8", fontWeight: 600 }}>
              {connected ? (status.pollingError ? "ERROR" : "LIVE") : "RECONNECTING"}
            </span>
          </div>
          {/* Logout */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img
              src={session?.user?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${session?.user?.email || "U"}&background=1e293b&color=94a3b8`}
              alt="avatar" style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--border-subtle)" }}
            />
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session?.user?.email}</div>
            </div>
            <button onClick={() => supabase.auth.signOut()}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "var(--text-muted)", padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>
              Out
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", marginLeft: 240 }}>
        {/* Topbar */}
        <header style={{ borderBottom: "1px solid var(--border-subtle)", padding: "0 28px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-secondary)", position: "sticky", top: 0, zIndex: 10 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>
              {navItems.find(n => n.id === activeTab)?.icon} {navItems.find(n => n.id === activeTab)?.label}
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {activeTab !== "scan" && (
              <button id="btn-manual-trigger" className="btn-trigger" onClick={() => { setActiveTab("scan"); }} disabled={!connected}>
                ⚡ Force Scan
              </button>
            )}
          </div>
        </header>

        <main className="main" style={{ padding: 28 }}>

          {/* ── DASHBOARD TAB ── */}
          {activeTab === "dashboard" && (
            <>
              <div className="stats-grid">
                <StatCard icon="📊" value={status.totalDetections || history.length} label="Total Scans"     sub="All time" />
                <StatCard icon="🚛" value={counts["mining-truck"]}                   label="Mining Trucks"   sub="Session" />
                <StatCard icon="🚨" value={counts["overloaded"]}                     label="Overloaded"      sub="Session" />
                <StatCard icon="📭" value={counts["empty-load"]}                     label="Empty Loads"     sub="Session" />
                <StatCard icon="🎯" value={avgConf !== "—" ? avgConf + "%" : "—"}   label="Avg Confidence"  sub="Session avg" />
              </div>

              {/* Recent snapshot */}
              {latest && (
                <div className="glass-panel" style={{ display: "flex", gap: 24, padding: 24, alignItems: "center", borderRadius: 16 }}>
                  {latest.imageUrl && (
                    <img src={latest.imageUrl} alt="latest" style={{ width: 200, height: 130, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border-subtle)" }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Latest Detection</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 4 }}>{getClassIcon(latest.classification)} {latest.classification}</div>
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{latest.filename}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{formatDateTime(latest.timestamp)}</div>
                  </div>
                  <button className="btn-trigger" onClick={() => setActiveTab("monitor")}>View Live →</button>
                </div>
              )}
            </>
          )}

          {/* ── MONITOR TAB ── */}
          {activeTab === "monitor" && (
            <>
              {status.pollingError && (
                <div className="error-banner">
                  <span className="error-icon">⚠️</span>
                  <div className="error-text"><strong>Polling Error:</strong> {status.pollingError}</div>
                </div>
              )}
              <div className="stats-grid">
                <StatCard icon="📊" value={status.totalDetections || history.length} label="Total Scans"     sub="All time" />
                <StatCard icon="🚛" value={counts["mining-truck"]}                   label="Mining Trucks"   sub="Session" />
                <StatCard icon="🚨" value={counts["overloaded"]}                     label="Overloaded"      sub="Session" />
                <StatCard icon="📭" value={counts["empty-load"]}                     label="Empty Loads"     sub="Session" />
                <StatCard icon="🎯" value={avgConf !== "—" ? avgConf + "%" : "—"}   label="Avg Confidence"  sub="Session avg" />
              </div>

              <div className="dashboard-grid">
                {/* Camera feed */}
                <div className="camera-card">
                  <div className="camera-header">
                    <div className="camera-title">
                      <span>📷</span>
                      <span>{viewDetection ? "Historical View" : "Live Camera From ESP AI Thinker"}</span>
                    </div>
                    <div className="image-timestamp">
                      {displayed ? formatDateTime(displayed.timestamp) : "Awaiting image…"}
                    </div>
                  </div>
                  <div className="image-wrapper">
                    {connected && !viewDetection && <div className="scan-line" />}
                    {displayed?.imageUrl ? (
                      <>
                        <img key={imageKey} src={displayed.imageUrl} alt={`Truck: ${displayed.classification}`} className={`truck-image ${!viewDetection ? "new-image" : ""}`} />
                        <div className="image-overlay" />
                        <div className="image-classification-badge">
                          <span className={`class-badge ${classKey}`}>{getClassIcon(displayed.classification)} {displayed.classification}</span>
                          <span className="confidence-chip">{((displayed.confidence || 0) * 100).toFixed(1)}% conf</span>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">
                        <div className="empty-icon">📡</div>
                        <div className="empty-title">{connected ? "Waiting for ESP32 Image…" : "Connecting to server…"}</div>
                        <div className="empty-desc">{connected ? "The system will automatically detect new images uploaded to your Supabase truck-images bucket." : "Please ensure the backend server is running on port 3001."}</div>
                        {connected && <div className="spinner" />}
                      </div>
                    )}
                  </div>
                  {displayed?.reason && (
                    <div className="reason-bar">
                      <span className="reason-label">AI Analysis</span>
                      <span>{displayed.reason}</span>
                    </div>
                  )}
                </div>

                {/* Right panel */}
                <div className="ai-panel">
                  <div className="result-card">
                    <div className="result-header"><span>🤖</span><span>AI Detection Result</span></div>
                    <div className="result-body">
                      <ClassificationBig classification={displayed?.classification || "Awaiting…"} classKey={classKey} />
                      {displayed && (
                        <>
                          <ConfidenceBar confidence={displayed.confidence} classKey={classKey} />
                          <div>
                            <div className="meta-row"><span className="meta-key">File</span><span className="meta-val">{displayed.filename}</span></div>
                            <div className="meta-row"><span className="meta-key">Size</span><span className="meta-val">{formatBytes(displayed.fileSize)}</span></div>
                            <div className="meta-row"><span className="meta-key">Detected at</span><span className="meta-val">{formatTime(displayed.timestamp)}</span></div>
                            <div className="meta-row"><span className="meta-key">Raw class</span><span className="meta-val">{displayed.raw_class || "—"}</span></div>
                          </div>
                        </>
                      )}
                      {!displayed && (
                        <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 14, padding: "16px 0" }}>
                          No detections yet. Upload an image to your Supabase <code style={{ color: "#94a3b8" }}>truck-images</code> bucket.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="history-card">
                    <div className="history-header">
                      <div className="history-title"><span>📋</span><span>Recent Detections</span></div>
                      <span className="history-count">{history.length}</span>
                    </div>
                    <div className="history-list">
                      {history.length === 0 ? (
                        <div style={{ padding: "24px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No detections logged yet.</div>
                      ) : (
                        history.slice(0, 10).map((item) => (
                          <HistoryItem key={item.id} item={item} onClick={(det) => setViewDetection(viewDetection?.id === det.id ? null : det)} />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── GALLERY TAB ── */}
          {activeTab === "gallery" && <BucketGallery />}

          {/* ── FORCE SCAN TAB ── */}
          {activeTab === "scan" && (
            <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24, paddingTop: 40 }}>
              <div className="glass-panel" style={{ borderRadius: 20, padding: "48px 40px", textAlign: "center" }}>
                <div style={{ fontSize: 60, marginBottom: 20 }}>⚡</div>
                <h2 style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginBottom: 10 }}>Force Scan</h2>
                <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
                  Manually trigger the AI detection pipeline to scan the latest image in your Supabase bucket.
                </p>

                {triggerMsg && (
                  <div style={{
                    marginBottom: 24, padding: "12px 20px", borderRadius: 10,
                    background: triggerMsg.type === "success" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                    border: `1px solid ${triggerMsg.type === "success" ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)"}`,
                    color: triggerMsg.type === "success" ? "#6ee7b7" : "#fca5a5",
                    fontSize: 14
                  }}>
                    {triggerMsg.type === "success" ? "✅" : "⚠️"} {triggerMsg.text}
                  </div>
                )}

                <button
                  id="btn-force-scan"
                  onClick={handleTrigger}
                  disabled={triggering || !connected}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 10,
                    padding: "16px 40px", borderRadius: 12, border: "none",
                    background: triggering ? "rgba(234,179,8,0.3)" : "linear-gradient(135deg, #eab308, #d97706)",
                    color: "#000", fontWeight: 800, fontSize: 16, cursor: triggering || !connected ? "not-allowed" : "pointer",
                    transition: "all 0.2s", opacity: !connected ? 0.5 : 1,
                  }}
                >
                  {triggering ? "⏳ Scanning…" : "⚡ Trigger Detection Now"}
                </button>

                {!connected && (
                  <p style={{ marginTop: 16, fontSize: 12, color: "#ef4444" }}>
                    ⚠️ Backend disconnected. Please ensure the server is running on port 3001.
                  </p>
                )}
              </div>

              {/* Status card */}
              <div className="glass-panel" style={{ borderRadius: 16, padding: 24 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 14, fontWeight: 700 }}>System Status</div>
                <div className="meta-row"><span className="meta-key">Backend Connection</span><span className="meta-val" style={{ color: connected ? "#10b981" : "#ef4444" }}>{connected ? "✅ Connected" : "❌ Disconnected"}</span></div>
                <div className="meta-row"><span className="meta-key">Polling Active</span><span className="meta-val" style={{ color: status.isPolling ? "#10b981" : "#94a3b8" }}>{status.isPolling ? "✅ Yes" : "—"}</span></div>
                <div className="meta-row"><span className="meta-key">Total Detections</span><span className="meta-val">{status.totalDetections || history.length}</span></div>
                {status.pollingError && <div className="meta-row"><span className="meta-key">Last Error</span><span className="meta-val" style={{ color: "#fca5a5" }}>{status.pollingError}</span></div>}
              </div>
            </div>
          )}

          {/* ── DETECTION LOGS TAB ── */}
          {activeTab === "logs" && <DetectionLogs history={history} />}

        </main>
      </div>
    </div>
  );
}
