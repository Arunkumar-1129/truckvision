import React, { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";

const API_BASE = "http://localhost:3001";

// ── Helpers ──────────────────────────────────────────────────────────────────
function getClassKey(classification) {
  if (!classification) return "mining-truck";
  const c = classification.toLowerCase();
  if (c.includes("empty")) return "empty-load";
  if (c.includes("overload")) return "overloaded";
  if (c.includes("full"))  return "full-load";
  return "mining-truck";
}

function getClassIcon(classification) {
  const k = getClassKey(classification);
  if (k === "empty-load")  return "🟢";
  if (k === "full-load")   return "🟡";
  if (k === "overloaded")  return "🚨";
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
        <div
          className={`conf-fill ${classKey}`}
          style={{ width: `${(confidence || 0) * 100}%` }}
        />
      </div>
    </div>
  );
}

function ClassificationBig({ classification, classKey }) {
  const icons = {
    "mining-truck": "🚛",
    "empty-load":   "📭",
    "full-load":    "⛏️",
    "overloaded":   "🚨",
  };
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
            <div className="meta-row">
              <span className="meta-key">Filename</span>
              <span className="meta-val" title={image.name}>{image.name}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Size</span>
              <span className="meta-val">{formatBytes(image.size)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Type</span>
              <span className="meta-val">{image.mimeType || "—"}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Uploaded</span>
              <span className="meta-val">{formatDateTime(image.createdAt)}</span>
            </div>
            {image.updatedAt && image.updatedAt !== image.createdAt && (
              <div className="meta-row">
                <span className="meta-key">Updated</span>
                <span className="meta-val">{formatDateTime(image.updatedAt)}</span>
              </div>
            )}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="lightbox-download"
            >
              ⬇ Open Full Image
            </a>
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
          <img
            src={url}
            alt={image.name}
            className="gallery-thumb"
            style={{ opacity: loaded ? 1 : 0 }}
            onLoad={() => setLoaded(true)}
            onError={() => { setLoaded(true); setErrored(true); }}
          />
        )}
        <div className="gallery-overlay">
          <span className="gallery-expand-icon">🔍</span>
        </div>
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
  const [images, setImages]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [search, setSearch]       = useState("");
  const [selected, setSelected]   = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  const fetchImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`${API_BASE}/api/bucket-images?limit=200`);
      setImages(data.images || []);
      setLastFetch(new Date());
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to load images");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  const filtered = images.filter((img) =>
    img.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="gallery-view">
      {/* Toolbar */}
      <div className="gallery-toolbar">
        <div className="gallery-toolbar-left">
          <div className="gallery-search-wrap">
            <span className="gallery-search-icon">🔍</span>
            <input
              className="gallery-search"
              type="text"
              placeholder="Search images…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="gallery-search-clear" onClick={() => setSearch("")}>✕</button>
            )}
          </div>
          <div className="gallery-count-badge">
            {loading ? "Loading…" : `${filtered.length} / ${images.length} images`}
          </div>
        </div>
        <div className="gallery-toolbar-right">
          {lastFetch && (
            <span className="gallery-last-fetch">
              Updated {formatTime(lastFetch.toISOString())}
            </span>
          )}
          <button className="btn-refresh" onClick={fetchImages} disabled={loading}>
            {loading ? "⏳ Loading…" : "🔄 Refresh"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <div className="error-text"><strong>Gallery Error:</strong> {error}</div>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && images.length === 0 && (
        <div className="gallery-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="gallery-card">
              <div className="gallery-thumb-wrap">
                <div className="gallery-skeleton" />
              </div>
              <div className="gallery-card-info">
                <div className="gallery-skel-line" style={{ width: "70%" }} />
                <div className="gallery-skel-line" style={{ width: "45%", marginTop: 4 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && images.length === 0 && !error && (
        <div className="empty-state" style={{ padding: "80px 20px" }}>
          <div className="empty-icon">🗂️</div>
          <div className="empty-title">No images in bucket</div>
          <div className="empty-desc">
            Upload images to your Supabase <code style={{ color: "#94a3b8" }}>truck-images</code> bucket to see them here.
          </div>
        </div>
      )}

      {/* No search results */}
      {!loading && images.length > 0 && filtered.length === 0 && (
        <div className="empty-state" style={{ padding: "60px 20px" }}>
          <div className="empty-icon" style={{ fontSize: 40 }}>🔍</div>
          <div className="empty-title">No matches for "{search}"</div>
          <div className="empty-desc">Try a different search term.</div>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div className="gallery-grid">
          {filtered.map((img) => (
            <GalleryCard key={img.id || img.name} image={img} onClick={setSelected} />
          ))}
        </div>
      )}

      {/* Lightbox */}
      {selected && (
        <ImageLightbox image={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ session, supabase }) {
  const [activeTab, setActiveTab]         = useState("monitor");
  const [status, setStatus]               = useState({ isPolling: false, pollingError: null, totalDetections: 0 });
  const [latest, setLatest]               = useState(null);
  const [history, setHistory]             = useState([]);
  const [triggering, setTriggering]       = useState(false);
  const [connected, setConnected]         = useState(false);
  const [imageKey, setImageKey]           = useState(0);
  const [viewDetection, setViewDetection] = useState(null);
  const sseRef = useRef(null);

  // ── SSE connection ──────────────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();

    const sse = new EventSource(`${API_BASE}/api/stream`);
    sseRef.current = sse;

    sse.addEventListener("connected", () => { setConnected(true); });

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

  // ── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    connectSSE();

    axios.get(`${API_BASE}/api/history?limit=20`)
      .then((r) => setHistory(r.data.history || []))
      .catch(() => {});

    axios.get(`${API_BASE}/api/latest`)
      .then((r) => { if (r.data.detection) setLatest(r.data.detection); })
      .catch(() => {});

    axios.get(`${API_BASE}/health`)
      .then((r) => setStatus({
        isPolling:       r.data.isPolling,
        pollingError:    r.data.pollingError,
        totalDetections: r.data.totalDetections,
      }))
      .catch(() => {});

    return () => { if (sseRef.current) sseRef.current.close(); };
  }, [connectSSE]);

  const handleTrigger = async () => {
    setTriggering(true);
    try { await axios.post(`${API_BASE}/api/trigger`); }
    catch (err) { console.error("Trigger error:", err); }
    finally { setTimeout(() => setTriggering(false), 2000); }
  };

  const displayed = viewDetection || latest;
  const classKey  = getClassKey(displayed?.classification);

  const counts = history.reduce(
    (acc, d) => { const k = getClassKey(d.classification); acc[k] = (acc[k] || 0) + 1; return acc; },
    { "mining-truck": 0, "empty-load": 0, "full-load": 0, "overloaded": 0 }
  );

  const avgConf = history.length
    ? (history.reduce((s, d) => s + (d.confidence || 0), 0) / history.length * 100).toFixed(1)
    : "—";

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-icon">🚛</div>
            <div>
              <div className="logo-text">TruckVision AI</div>
              <div className="logo-sub">Mining Load Monitor</div>
            </div>
          </div>

          {/* Tab nav */}
          <div className="tab-nav">
            <button
              id="tab-monitor"
              className={`tab-btn ${activeTab === "monitor" ? "active" : ""}`}
              onClick={() => setActiveTab("monitor")}
            >
              📡 Live Monitor
            </button>
            <button
              id="tab-gallery"
              className={`tab-btn ${activeTab === "gallery" ? "active" : ""}`}
              onClick={() => setActiveTab("gallery")}
            >
              🖼️ Image Gallery
            </button>
          </div>

          <div className="header-status">
            <div className="live-badge">
              <div className={`live-dot ${!connected ? "offline" : status.pollingError ? "error" : ""}`} />
              {connected ? (status.pollingError ? "ERROR" : "LIVE") : "RECONNECTING"}
            </div>
            <button
              id="btn-manual-trigger"
              className="btn-trigger"
              onClick={handleTrigger}
              disabled={triggering || !connected}
            >
              {triggering ? "⏳ Scanning…" : "⚡ Force Scan"}
            </button>
            
            {/* User Profile / Logout */}
            <div className="user-profile" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '16px', paddingLeft: '16px', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
              <img 
                src={session?.user?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${session?.user?.email || 'User'}&background=random`} 
                alt="User Avatar" 
                className="user-avatar"
                style={{ width: '32px', height: '32px', borderRadius: '50%' }}
              />
              <button 
                className="btn-logout" 
                onClick={() => supabase.auth.signOut()}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="main">

        {/* ── MONITOR TAB ── */}
        {activeTab === "monitor" && (
          <>
            {status.pollingError && (
              <div className="error-banner">
                <span className="error-icon">⚠️</span>
                <div className="error-text">
                  <strong>Polling Error:</strong> {status.pollingError}
                </div>
              </div>
            )}

            <div className="stats-grid">
              <StatCard icon="📊" value={status.totalDetections || history.length} label="Total Scans"      sub="All time" />
              <StatCard icon="🚛" value={counts["mining-truck"]}                  label="Mining Trucks"    sub="Session" />
              <StatCard icon="🚨" value={counts["overloaded"]}                    label="Overloaded"       sub="Session" />
              <StatCard icon="📭" value={counts["empty-load"]}                    label="Empty Loads"      sub="Session" />
              <StatCard icon="🎯" value={avgConf !== "—" ? avgConf + "%" : "—"}  label="Avg Confidence"   sub="Session avg" />
            </div>

            <div className="dashboard-grid">
              {/* Camera feed */}
              <div className="camera-card">
                <div className="camera-header">
                  <div className="camera-title">
                    <span>📷</span>
                    <span>{viewDetection ? "Historical View" : "Live ESP32 Feed"}</span>
                  </div>
                  <div className="image-timestamp">
                    {displayed ? formatDateTime(displayed.timestamp) : "Awaiting image…"}
                  </div>
                </div>

                <div className="image-wrapper">
                  {connected && !viewDetection && <div className="scan-line" />}

                  {displayed?.imageUrl ? (
                    <>
                      <img
                        key={imageKey}
                        src={displayed.imageUrl}
                        alt={`Truck: ${displayed.classification}`}
                        className={`truck-image ${!viewDetection ? "new-image" : ""}`}
                      />
                      <div className="image-overlay" />
                      
                      {classKey === "overloaded" && (
                        <div className="overload-alert-banner">
                          ⚠️ CRITICAL: TRUCK OVERLOADED
                        </div>
                      )}

                      <div className="image-classification-badge">
                        <span className={`class-badge ${classKey}`}>
                          {getClassIcon(displayed.classification)} {displayed.classification}
                        </span>
                        <span className="confidence-chip">
                          {((displayed.confidence || 0) * 100).toFixed(1)}% conf
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">📡</div>
                      <div className="empty-title">
                        {connected ? "Waiting for ESP32 Image…" : "Connecting to server…"}
                      </div>
                      <div className="empty-desc">
                        {connected
                          ? "The system will automatically detect new images uploaded to your Supabase truck-images bucket."
                          : "Please ensure the backend server is running on port 3001."}
                      </div>
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
                  <div className="result-header">
                    <span>🤖</span>
                    <span>YOLOv8 Detection (best.pt)</span>
                  </div>
                  <div className="result-body">
                    <ClassificationBig
                      classification={displayed?.classification || "Awaiting…"}
                      classKey={classKey}
                    />

                    {displayed && (
                      <>
                        <ConfidenceBar confidence={displayed.confidence} classKey={classKey} />
                        <div>
                          <div className="meta-row"><span className="meta-key">File</span><span className="meta-val">{displayed.filename}</span></div>
                          <div className="meta-row"><span className="meta-key">Size</span><span className="meta-val">{formatBytes(displayed.fileSize)}</span></div>
                          <div className="meta-row"><span className="meta-key">Detected at</span><span className="meta-val">{formatTime(displayed.timestamp)}</span></div>
                          <div className="meta-row"><span className="meta-key">Raw class</span><span className="meta-val">{displayed.raw_class || "—"}</span></div>
                          <div className="meta-row"><span className="meta-key">Model</span><span className="meta-val">YOLOv8 (best.pt)</span></div>
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

                {/* Detection history */}
                <div className="history-card">
                  <div className="history-header">
                    <div className="history-title"><span>📋</span><span>Detection Log</span></div>
                    <span className="history-count">{history.length}</span>
                  </div>
                  <div className="history-list">
                    {history.length === 0 ? (
                      <div style={{ padding: "24px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                        No detections logged yet.
                      </div>
                    ) : (
                      history.map((item) => (
                        <HistoryItem
                          key={item.id}
                          item={item}
                          onClick={(det) => setViewDetection(viewDetection?.id === det.id ? null : det)}
                        />
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

      </main>
    </div>
  );
}
