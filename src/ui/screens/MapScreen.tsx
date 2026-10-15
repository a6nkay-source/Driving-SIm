import { useEffect, useMemo, useRef, useState } from 'react';
import { appStore, setSession, toast } from '../../app/state';
import { settingsStore, type Settings } from '../../core/settings';
import { useStore } from '../../core/store';
import { FALLBACK_CONFIG } from '../../map/fallback';
import { routesFor } from '../../nav/routes';
import { BackButton } from '../components/BackButton';
import { useController } from '../context';
import { drawMap, loadPreview, screenToWorld, worldToScreen, type DrawOptions, type MapPreview } from '../mapPreview';

interface Marker {
  x: number;
  z: number;
  label: string;
  kind: 'dest' | 'dest-on' | 'start' | 'custom' | 'player' | 'cp';
  heading?: number;
}

function MapCanvas({ preview, markers, route, onPick }: { preview: MapPreview; markers: Marker[]; route: number[] | null; onPick: (x: number, z: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<DrawOptions | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [, force] = useState(0);
  const redraw = () => force((n) => n + 1);

  const fit = () => {
    const c = ref.current;
    if (!c) return;
    const b = preview.manifest.bounds;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const scale = Math.min(w / (b.maxX - b.minX), h / (b.maxZ - b.minZ)) * 0.95;
    view.current = { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, scale };
  };

  useEffect(() => {
    view.current = null;
    redraw();
  }, [preview]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    if (!view.current) fit();
    const o = view.current!;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(ctx, w, h, preview, o);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (route && route.length >= 4) {
      ctx.strokeStyle = '#ffb23f';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(255,170,50,0.8)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let i = 0; i < route.length; i += 2) {
        const [sx, sy] = worldToScreen(route[i], route[i + 1], w, h, o);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.font = '600 13px Rajdhani, sans-serif';
    for (const m of markers) {
      const [sx, sy] = worldToScreen(m.x, m.z, w, h, o);
      if (m.kind === 'player') {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-(m.heading ?? 0));
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ffb23f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(7, 8);
        ctx.lineTo(0, 4);
        ctx.lineTo(-7, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        continue;
      }
      const on = m.kind === 'dest-on' || m.kind === 'custom';
      const color = m.kind === 'start' ? '#58d38c' : m.kind === 'cp' ? '#7fb2ff' : on ? '#ffb23f' : '#c8cdd5';
      if (on) {
        ctx.fillStyle = 'rgba(255,178,63,0.22)';
        ctx.beginPath();
        ctx.arc(sx, sy, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = '#06101d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (m.kind === 'start') {
        ctx.moveTo(sx, sy - 8);
        ctx.lineTo(sx + 7, sy + 6);
        ctx.lineTo(sx - 7, sy + 6);
        ctx.closePath();
      } else ctx.arc(sx, sy, on ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (m.label) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(4,8,16,0.85)';
        ctx.strokeText(m.label, sx + 10, sy + 4);
        ctx.fillStyle = on ? '#ffd38a' : '#dfe3ea';
        ctx.fillText(m.label, sx + 10, sy + 4);
      }
    }
  });

  const onWheel = (e: React.WheelEvent) => {
    const c = ref.current;
    const o = view.current;
    if (!c || !o) return;
    const rect = c.getBoundingClientRect();
    const [wx, wz] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height, o);
    const k = Math.exp(-e.deltaY * 0.0015);
    o.scale = Math.max(0.05, Math.min(8, o.scale * k));
    // Keep the point under the cursor fixed.
    const [nx, nz] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height, o);
    o.cx += wx - nx;
    o.cz += wz - nz;
    redraw();
  };

  return (
    <>
      <canvas
        ref={ref}
        className="map-canvas"
        aria-label="District map. Drag to pan, scroll to zoom, click to set a destination."
        onWheel={onWheel}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const o = view.current;
          if (!d || !o) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (d.moved) {
            o.cx -= dx / o.scale;
            o.cz -= dy / o.scale;
            d.x = e.clientX;
            d.y = e.clientY;
            redraw();
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          const c = ref.current;
          const o = view.current;
          if (!d || d.moved || !c || !o) return;
          const rect = c.getBoundingClientRect();
          const [x, z] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height, o);
          onPick(x, z);
        }}
      />
      <div className="map-zoom">
        <button aria-label="Zoom in" onClick={() => view.current && ((view.current.scale *= 1.4), redraw())}>
          +
        </button>
        <button aria-label="Zoom out" onClick={() => view.current && ((view.current.scale /= 1.4), redraw())}>
          −
        </button>
        <button aria-label="Fit map" onClick={() => (fit(), redraw())} style={{ fontSize: 13 }}>
          ⤢
        </button>
      </div>
    </>
  );
}

export function MapScreen() {
  const ctrl = useController();
  const session = useStore(appStore, (s) => s.session);
  const districts = useStore(appStore, (s) => s.districts);
  const returnTo = useStore(appStore, (s) => s.returnTo);
  const settings = useStore(settingsStore, (s) => s);
  const fromPause = returnTo === 'paused' && !!ctrl.drive;
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => ctrl.setMenuMode('map'), [ctrl]);
  useEffect(() => {
    let alive = true;
    setPreview(null);
    setError(null);
    loadPreview(session.district, ctrl.drive?.map)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [session.district, ctrl]);
  useEffect(() => {
    if (!fromPause) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [fromPause]);

  const allDistricts = useMemo(
    () => [...districts.map((d) => ({ id: d.id, name: d.name, blurb: d.blurb, real: true, meta: `${d.roadKm} km roads · ${d.buildings.toLocaleString()} buildings` })), { id: 'fallback', name: FALLBACK_CONFIG.name, blurb: FALLBACK_CONFIG.blurb, real: false, meta: 'Fictional · always available offline' }],
    [districts],
  );
  const destinations = preview?.manifest.destinations ?? [];
  const routes = routesFor(session.district);
  const liveDistrict = ctrl.drive?.map?.manifest.id;
  const sameDistrict = fromPause && liveDistrict === session.district;

  const markers: Marker[] = [];
  if (preview) {
    if (session.mode === 'checkpoints') {
      const r = routes.find((x) => x.id === session.route) ?? routes[0];
      r?.stops.forEach((id, i) => {
        const d = destinations.find((x) => x.id === id);
        if (d) markers.push({ x: d.x, z: d.z, label: `${i + 1}. ${d.name}`, kind: i === 0 ? 'start' : 'cp' });
      });
    } else {
      for (const d of destinations) markers.push({ x: d.x, z: d.z, label: d.name, kind: d.id === session.destination && !session.customDestination ? 'dest-on' : 'dest' });
      const start = session.start === 'spawn' ? preview.manifest.spawn : destinations.find((d) => d.id === session.start);
      if (start && !sameDistrict) markers.push({ x: start.x, z: start.z, label: session.start === 'spawn' ? `Start · ${preview.manifest.spawn.label}` : '', kind: 'start' });
      if (session.customDestination) markers.push({ x: session.customDestination.x, z: session.customDestination.z, label: 'Waypoint', kind: 'custom' });
    }
    const t = ctrl.drive?.telemetry;
    if (sameDistrict && t) markers.push({ x: t.x, z: t.z, label: '', kind: 'player', heading: t.heading });
  }
  const route = sameDistrict ? ctrl.drive?.routePoints() ?? null : null;

  const setWorld = (patch: Partial<Settings>) => settingsStore.set(patch);
  const confirm = () => {
    ctrl.audio.ui('click');
    if (fromPause && sameDistrict) {
      ctrl.applySessionToDrive();
      appStore.set({ returnTo: 'menu' });
      ctrl.resume();
      toast(session.mode === 'checkpoints' ? 'Checkpoint challenge set' : 'Destination updated', 'success');
    } else {
      appStore.set({ returnTo: 'menu' });
      void ctrl.play();
    }
  };

  return (
    <div className="screen">
      <div className="side-panel panel" style={{ width: 'min(400px, 100%)' }}>
        <div className="screen-header">
          <BackButton />
          <div>
            <div className="crumb">Map</div>
            <h2>Where to?</h2>
          </div>
        </div>

        <div className="section" style={{ marginTop: 0 }}>
          <div className="section-title">District</div>
          <div className="list">
            {allDistricts.map((d) => (
              <button
                key={d.id}
                className={`list-item ${session.district === d.id ? 'on' : ''}`}
                onClick={() => {
                  ctrl.audio.ui('click');
                  const first = routesFor(d.id)[0];
                  setSession({ district: d.id, start: 'spawn', destination: '', customDestination: null, route: first?.id ?? '' });
                }}
              >
                <div>
                  <div className="t">{d.name}</div>
                  <div className="s">{d.meta}</div>
                </div>
                {!d.real && <span className="s">fictional</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section-title">Mode</div>
          <div className="chips">
            <button className={`chip ${session.mode === 'free' ? 'on' : ''}`} onClick={() => setSession({ mode: 'free' })}>
              Free roam
            </button>
            <button
              className={`chip ${session.mode === 'checkpoints' ? 'on' : ''}`}
              disabled={routes.length === 0}
              onClick={() => setSession({ mode: 'checkpoints', route: session.route && routes.some((r) => r.id === session.route) ? session.route : routes[0]?.id ?? '' })}
            >
              Checkpoint challenge
            </button>
          </div>
        </div>

        {session.mode === 'free' ? (
          <>
            <div className="section">
              <div className="section-title">
                Destination <span className="value">{session.customDestination ? 'Map waypoint' : destinations.find((d) => d.id === session.destination)?.name ?? 'None'}</span>
              </div>
              <div className="list">
                <button className={`list-item ${!session.destination && !session.customDestination ? 'on' : ''}`} onClick={() => setSession({ destination: '', customDestination: null })}>
                  <div className="t">No destination</div>
                  <div className="s">Just drive</div>
                </button>
                {destinations.map((d) => (
                  <button key={d.id} className={`list-item ${session.destination === d.id && !session.customDestination ? 'on' : ''}`} onClick={() => setSession({ destination: d.id, customDestination: null })}>
                    <div className="t">{d.name}</div>
                    {d.nameMr && <div className="mr">{d.nameMr}</div>}
                  </button>
                ))}
              </div>
              <p className="prose" style={{ fontSize: 14, color: 'var(--muted)', marginTop: 10 }}>
                Tip: click anywhere on the map to drop a custom waypoint.
              </p>
            </div>
            {!sameDistrict && (
              <div className="section">
                <div className="section-title">Start at</div>
                <select className="text-input" style={{ letterSpacing: '0.04em', textTransform: 'none' }} value={session.start} onChange={(e) => setSession({ start: e.target.value })} aria-label="Start location">
                  <option value="spawn">{preview?.manifest.spawn.label ?? 'Default start'}</option>
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        ) : (
          <div className="section">
            <div className="section-title">Challenge route</div>
            <div className="list">
              {routes.map((r) => (
                <button key={r.id} className={`list-item ${session.route === r.id ? 'on' : ''}`} onClick={() => setSession({ route: r.id })}>
                  <div>
                    <div className="t">{r.name}</div>
                    <div className="s">{r.blurb}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="section">
          <div className="section-title">Conditions</div>
          <div className="chips">
            {(['day', 'sunset', 'night'] as const).map((t) => (
              <button key={t} className={`chip ${settings.timeOfDay === t ? 'on' : ''}`} onClick={() => setWorld({ timeOfDay: t })}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
            {(['clear', 'monsoon'] as const).map((w) => (
              <button key={w} className={`chip ${settings.weather === w ? 'on' : ''}`} onClick={() => setWorld({ weather: w })}>
                {w === 'clear' ? 'Clear' : 'Monsoon'}
              </button>
            ))}
          </div>
        </div>

        <div className="btn-row">
          <button className="btn primary" onClick={confirm}>
            {fromPause ? (sameDistrict ? 'Apply & resume' : 'Restart here') : 'Drive'}
          </button>
          {session.mode === 'free' && (session.destination || session.customDestination) && (
            <button className="btn ghost" onClick={() => setSession({ destination: '', customDestination: null })}>
              Clear destination
            </button>
          )}
        </div>
      </div>

      <div className="map-wrap">
        {preview ? (
          <MapCanvas
            preview={preview}
            markers={markers}
            route={route}
            onPick={(x, z) => {
              if (session.mode !== 'free') return;
              ctrl.audio.ui('click');
              setSession({ customDestination: { x, z }, destination: '' });
            }}
          />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)' }}>{error ? `Map preview unavailable: ${error}` : 'Loading map…'}</div>
        )}
        <div className="map-legend">
          <span>
            <i style={{ background: '#d9a04a' }} />
            Arterial
          </span>
          <span>
            <i style={{ background: '#8e97a6' }} />
            Secondary
          </span>
          <span>
            <i style={{ background: '#b994ff' }} />
            Flyover
          </span>
          <span>
            <i style={{ background: '#17321f' }} />
            Park
          </span>
        </div>
        <div className="map-attrib">
          {preview && !preview.manifest.real ? (
            'Fictional procedural map'
          ) : (
            <>
              ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap contributors
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
