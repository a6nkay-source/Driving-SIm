import { useEffect, useRef, useState } from 'react';
import { appStore } from '../../app/state';
import { settingsStore } from '../../core/settings';
import { useStore } from '../../core/store';
import type { Telemetry } from '../../drive/DriveScene';
import { FLEET } from '../../vehicle/fleet';
import { useController } from '../context';
import { Captions, CommandBar } from './CommandBar';
import { drawMap, loadPreview, worldToScreen, type MapPreview } from '../mapPreview';

const ARC_START = -225;
const ARC_SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

function Speedo({ max, unit, redline }: { max: number; unit: string; redline: number }) {
  const ticks = [];
  const step = max > 250 ? 20 : 10;
  for (let v = 0; v <= max; v += step) {
    const a = ARC_START + (v / max) * ARC_SWEEP;
    const major = v % (step * 2) === 0;
    const [x0, y0] = polar(115, 115, 100, a);
    const [x1, y1] = polar(115, 115, major ? 88 : 93, a);
    ticks.push(<line key={v} x1={x0} y1={y0} x2={x1} y2={y1} stroke={major ? '#c8cdd5' : '#5b6270'} strokeWidth={major ? 2 : 1} />);
    if (major) {
      const [tx, ty] = polar(115, 115, 76, a);
      ticks.push(
        <text key={`t${v}`} x={tx} y={ty + 4} textAnchor="middle" fontSize="10" fill="#8b93a1" fontFamily="Rajdhani" fontWeight="600">
          {v}
        </text>,
      );
    }
  }
  return (
    <svg viewBox="0 0 230 230" aria-hidden>
      <defs>
        <linearGradient id="rpmGrad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#d9860f" />
          <stop offset="75%" stopColor="#ffd38a" />
          <stop offset="100%" stopColor="#ff5f52" />
        </linearGradient>
        <radialGradient id="dial" cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="rgba(5,8,15,0.75)" />
          <stop offset="100%" stopColor="rgba(5,8,15,0.35)" />
        </radialGradient>
      </defs>
      <circle cx="115" cy="115" r="112" fill="url(#dial)" stroke="rgba(200,210,225,0.18)" strokeWidth="1.5" />
      <path d={arcPath(115, 115, 106, ARC_START, ARC_START + ARC_SWEEP)} stroke="rgba(255,255,255,0.06)" strokeWidth="5" fill="none" />
      <path id="hud-rpm" d={arcPath(115, 115, 106, ARC_START, ARC_START + 0.1)} stroke="url(#rpmGrad)" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d={arcPath(115, 115, 106, ARC_START + ARC_SWEEP * redline, ARC_START + ARC_SWEEP)} stroke="rgba(255,95,82,0.5)" strokeWidth="5" fill="none" />
      {ticks}
      <g id="hud-needle" style={{ transformOrigin: '115px 115px' }}>
        <line x1="115" y1="115" x2="115" y2="22" stroke="#ffb23f" strokeWidth="3" strokeLinecap="round" />
        <circle cx="115" cy="115" r="7" fill="#ffb23f" />
        <circle cx="115" cy="115" r="3" fill="#05080f" />
      </g>
      <text x="115" y="214" textAnchor="middle" fontSize="9" letterSpacing="3" fill="#5b6270" fontFamily="Rajdhani">
        RPM
      </text>
      <text x="115" y="150" textAnchor="middle" fontSize="9" letterSpacing="3" fill="#5b6270" fontFamily="Rajdhani">
        {unit}
      </text>
    </svg>
  );
}

const AP_STATUS: Record<string, string> = {
  driving: 'Cruising',
  turning: 'Taking the turn',
  signal: 'Waiting at the signal',
  traffic: 'Following traffic',
  arriving: 'Pulling in',
  arrived: 'Arrived',
  recovering: 'Backing up',
};

const TURN_GLYPH: Record<string, string> = { left: '↰', right: '↱', straight: '↑', uturn: '↶', arrive: '◎', 'slight-left': '↖', 'slight-right': '↗' };

export function Hud() {
  const ctrl = useController();
  const settings = useStore(settingsStore, (s) => s);
  const audioBlocked = useStore(appStore, (s) => s.audioBlocked);
  const [slow, setSlow] = useState<Telemetry | null>(null);
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const kmhRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const cpTimeRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const mph = settings.units === 'mph';
  const vehicle = useVehicle(ctrl);
  const spec = FLEET[vehicle].params;
  const kmhMax = vehicle === 'auto' ? 80 : vehicle === 'bus' ? 100 : vehicle === 'taxi' ? 160 : 340;
  const max = mph ? Math.round((kmhMax * 0.621371) / 10) * 10 : kmhMax;
  const rpmMax = Math.ceil((spec.redline * 1.12) / 1000) * 1000;

  useEffect(() => {
    const map = ctrl.drive?.map;
    if (!map) return;
    let alive = true;
    void loadPreview(map.manifest.id, map).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [ctrl]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const needle = document.getElementById('hud-needle');
    const rpmArc = document.getElementById('hud-rpm');
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const drive = ctrl.drive;
      const t = drive?.telemetry;
      if (!t) return;
      const speed = Math.abs(t.speed) * (mph ? 2.23694 : 3.6);
      if (kmhRef.current) kmhRef.current.textContent = String(Math.round(speed));
      if (needle) needle.style.transform = `rotate(${(Math.min(speed, max) / max) * ARC_SWEEP - 135}deg)`;
      if (rpmArc) rpmArc.setAttribute('d', arcPath(115, 115, 106, ARC_START, ARC_START + 0.1 + Math.min(1, t.rpm / rpmMax) * ARC_SWEEP));
      if (gearRef.current) {
        const g = t.gear < 0 ? 'R' : Math.abs(t.speed) < 0.3 && t.throttle < 0.05 ? 'N' : String(t.gear);
        gearRef.current.textContent = g;
        gearRef.current.className = `gear ${g === 'R' ? 'r' : ''}`;
      }
      if (cpTimeRef.current && t.checkpoint) cpTimeRef.current.textContent = formatTime(t.checkpoint.time);
      if (fpsRef.current) fpsRef.current.textContent = `${Math.round(ctrl.engine.fps)} FPS`;
      if (vignetteRef.current) vignetteRef.current.style.opacity = String(Math.max(0, Math.min(0.8, (Math.abs(t.speed) - 35) / 50)));
      // Minimap.
      const c = miniRef.current;
      if (c && preview) {
        const w = c.clientWidth;
        const h = c.clientHeight;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (c.width !== Math.round(w * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        const ctx = c.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const scale = (w / 2 / 260) * (1 - Math.min(0.45, Math.abs(t.speed) / 160));
        const o = { cx: t.x, cz: t.z, scale, rotation: t.heading, minimal: true };
        drawMap(ctx, w, h, preview, o);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const route = drive.routePoints();
        if (route && route.length >= 4) {
          ctx.strokeStyle = '#ffb23f';
          ctx.lineWidth = 3.5;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (let i = 0; i < route.length; i += 2) {
            const [sx, sy] = worldToScreen(route[i], route[i + 1], w, h, o);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
        const target = drive.targetPoint();
        if (target) {
          let [sx, sy] = worldToScreen(target.x, target.z, w, h, o);
          const dx = sx - w / 2;
          const dy = sy - h / 2;
          const r = Math.hypot(dx, dy);
          const lim = w / 2 - 12;
          if (r > lim) {
            sx = w / 2 + (dx / r) * lim;
            sy = h / 2 + (dy / r) * lim;
          }
          ctx.fillStyle = target.kind === 'checkpoint' ? '#7fb2ff' : '#ffb23f';
          ctx.strokeStyle = '#06101d';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        // Traffic blips.
        ctx.fillStyle = 'rgba(200,210,225,0.55)';
        for (const p of drive.trafficPoints()) {
          const [sx, sy] = worldToScreen(p[0], p[1], w, h, o);
          if (Math.hypot(sx - w / 2, sy - h / 2) < w / 2) ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
        }
        // Player arrow.
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ffb23f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(w / 2, h / 2 - 10);
        ctx.lineTo(w / 2 + 7, h / 2 + 8);
        ctx.lineTo(w / 2, h / 2 + 4);
        ctx.lineTo(w / 2 - 7, h / 2 + 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      if (now - last > 250) {
        last = now;
        setSlow({ ...t, nav: t.nav ? { ...t.nav } : null, checkpoint: t.checkpoint ? { ...t.checkpoint } : null });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ctrl, preview, mph, max, rpmMax]);

  const t = slow;
  const km = (t?.odometer ?? 0) / 1000;
  const dist = (m: number) => (mph ? (m < 1609 ? `${Math.round(m * 1.09361)} yd` : `${(m / 1609.34).toFixed(1)} mi`) : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const virt = ctrl.input.virtual;
  const hold = (key: 'throttle' | 'brake' | 'handbrake' | 'left' | 'right') => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (key === 'left') virt.steer = 1;
      else if (key === 'right') virt.steer = -1;
      else virt[key] = 1;
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort (e.g. synthetic or already-released pointers) */
      }
    },
    onPointerUp: () => {
      if (key === 'left' || key === 'right') virt.steer = 0;
      else virt[key] = 0;
    },
    onPointerCancel: () => {
      if (key === 'left' || key === 'right') virt.steer = 0;
      else virt[key] = 0;
    },
  });

  return (
    <div className="hud">
      <div className="speed-lines" ref={vignetteRef} />
      <div className="status-icons">
        <button className="hud-panel hud-pause pointer" onClick={() => ctrl.pause()} aria-label="Pause">
          ❚❚
        </button>
        <div className={`hud-panel ic ${t?.headlights ? 'on' : ''}`} title="Headlights (L)">
          LIGHTS
        </div>
        <div className="hud-panel ic" title="Camera (C)">
          {(t?.camera ?? settings.camera).toUpperCase()}
        </div>
        {settings.muted && <div className="hud-panel ic on">MUTED</div>}
        {audioBlocked && !settings.muted && (
          <button className="hud-panel hud-pause pointer" onClick={() => ctrl.unlockAudio()} title="Your browser blocked audio until you interact with the page">
            🔇 CLICK FOR SOUND
          </button>
        )}
        {settings.weather === 'monsoon' && <div className="hud-panel ic on">MONSOON</div>}
      </div>

      {t?.nav && !t.checkpoint && (
        <div className="nav-card hud-panel">
          <div className="turn">{TURN_GLYPH[t.nav.turn] ?? '↑'}</div>
          <div style={{ minWidth: 0 }}>
            <div className="dist">{t.nav.turn === 'arrive' && t.nav.distance < 40 ? 'Arrived' : dist(t.nav.stepDistance)}</div>
            <div className="instr">
              {t.nav.instruction} · {dist(t.nav.distance)} to {t.nav.destName}
            </div>
          </div>
        </div>
      )}

      {t?.autopilot && (
        <div className="autopilot-pill hud-panel">
          <span className="dot" aria-hidden />
          <span className="k">AUTOPILOT</span>
          <span className="v">
            {AP_STATUS[t.autopilot.status] ?? 'Driving'} · {Math.round(t.autopilot.target * (mph ? 2.23694 : 3.6))} {mph ? 'mph' : 'km/h'}
          </span>
          <span className="hint">Any key takes over</span>
        </div>
      )}

      <CommandBar />
      <Captions />

      {t?.checkpoint && (
        <div className="checkpoint-hud hud-panel">
          <div className="cp">
            {t.checkpoint.routeName.toUpperCase()} · {t.checkpoint.finished ? 'FINISHED' : `CHECKPOINT ${t.checkpoint.index + 1}/${t.checkpoint.total}`}
          </div>
          <div className="time" ref={cpTimeRef}>
            {formatTime(t.checkpoint.time)}
          </div>
          {t.checkpoint.best !== undefined && <div className="cp">BEST {formatTime(t.checkpoint.best)}</div>}
        </div>
      )}

      <div className="trip hud-panel">
        <div>
          <div className="k">Distance</div>
          <div className="v">{mph ? `${(km * 0.621371).toFixed(2)} mi` : `${km.toFixed(2)} km`}</div>
        </div>
        <div>
          <div className="k">Time</div>
          <div className="v">{formatClock(t?.elapsed ?? 0)}</div>
        </div>
      </div>

      <div className="minimap">
        <canvas ref={miniRef} aria-label="Minimap" />
      </div>

      {t?.roadName && (
        <div className="road-name hud-panel">
          <div className="en">{t.roadName}</div>
          {t.roadNameMr && <div className="mr">{t.roadNameMr}</div>}
        </div>
      )}

      <div className="speedo">
        <Speedo max={max} unit={mph ? 'MPH' : 'KM/H'} redline={spec.redline / rpmMax} />
        <div className="readout">
          <div className="kmh" ref={kmhRef}>
            0
          </div>
        </div>
        <div className="gear" ref={gearRef}>
          N
        </div>
      </div>

      {settings.showFps && <div className="fps" ref={fpsRef} />}

      {touch && (
        <div className="touch-controls">
          <button className="pointer" style={{ left: 16, bottom: 24 }} aria-label="Steer left" {...hold('left')}>
            ◀
          </button>
          <button className="pointer" style={{ left: 104, bottom: 24 }} aria-label="Steer right" {...hold('right')}>
            ▶
          </button>
          <button className="pointer" style={{ right: 16, bottom: 110 }} aria-label="Accelerate" {...hold('throttle')}>
            ▲
          </button>
          <button className="pointer" style={{ right: 16, bottom: 24 }} aria-label="Brake or reverse" {...hold('brake')}>
            ▼
          </button>
          <button className="pointer" style={{ right: 104, bottom: 24, fontSize: 14 }} aria-label="Handbrake" {...hold('handbrake')}>
            HB
          </button>
        </div>
      )}
    </div>
  );
}

/** The player's vehicle, re-read when it changes (it lives in the drive scene). */
function useVehicle(ctrl: ReturnType<typeof useController>) {
  const [v, setV] = useState(ctrl.drive?.telemetry.vehicle ?? 'gtr');
  useEffect(() => {
    const id = setInterval(() => {
      const cur = ctrl.drive?.telemetry.vehicle;
      if (cur && cur !== v) setV(cur);
    }, 300);
    return () => clearInterval(id);
  }, [ctrl, v]);
  return v;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}

function formatClock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
