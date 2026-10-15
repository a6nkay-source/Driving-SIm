import { useCallback, useEffect, useState } from 'react';
import { appStore } from '../../app/state';
import { carStore, paintById } from '../../core/carConfig';
import { settingsStore } from '../../core/settings';
import { useStore } from '../../core/store';
import { useController } from '../context';

const ITEMS = [
  { id: 'play', label: 'Play', sub: 'Free roam · checkpoints · waypoints', shot: 0 },
  { id: 'garage', label: 'Garage', sub: 'Paint · wheels · calipers · aero', shot: 2 },
  { id: 'map', label: 'Map', sub: 'Districts · start · destination', shot: 3 },
  { id: 'settings', label: 'Settings', sub: 'Graphics · audio · controls', shot: 1 },
  { id: 'about', label: 'About', sub: 'Credits · data · licences', shot: 0 },
] as const;

const TIME_LABEL = { day: 'Day', sunset: 'Sunset', night: 'Night' } as const;

export function MainMenu() {
  const ctrl = useController();
  const [active, setActive] = useState(0);
  const car = useStore(carStore, (s) => s);
  const session = useStore(appStore, (s) => s.session);
  const districts = useStore(appStore, (s) => s.districts);
  const settings = useStore(settingsStore, (s) => s);
  const district = districts.find((d) => d.id === session.district);

  const activate = useCallback(
    (id: (typeof ITEMS)[number]['id']) => {
      ctrl.unlockAudio();
      ctrl.audio.ui('click');
      if (id === 'play') void ctrl.play();
      else ctrl.navigate(id);
    },
    [ctrl],
  );

  useEffect(() => {
    ctrl.setMenuMode('menu');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setActive((a) => (a + 1) % ITEMS.length);
        ctrl.audio.ui('hover');
      } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        setActive((a) => (a + ITEMS.length - 1) % ITEMS.length);
        ctrl.audio.ui('hover');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setActive((a) => {
          activate(ITEMS[a].id);
          return a;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctrl, activate]);

  useEffect(() => {
    ctrl.previewShot(ITEMS[active].shot);
  }, [active, ctrl]);
  useEffect(() => () => ctrl.previewShot(null), [ctrl]);

  const paint = paintById(car.paint);
  return (
    <>
      <div className="menu" onPointerDown={() => ctrl.unlockAudio()}>
        <div className="brand">
          <div className="brand-kicker">Open-world driving</div>
          <h1>
            <span className="drive">Drive</span>
            <span className="mumbai">Mumbai</span>
          </h1>
          <div className="brand-sub">
            <span className="mr">मुंबई</span>
            <span>Real OpenStreetMap streets · Marine Drive to Colaba</span>
          </div>
        </div>
        <ul className="menu-list" role="menu">
          {ITEMS.map((item, i) => (
            <li key={item.id} className="menu-item" style={{ animationDelay: `${0.7 + i * 0.08}s` }}>
              <button
                role="menuitem"
                className={`menu-btn ${i === active ? 'active' : ''} ${item.id === 'play' ? 'primary' : ''}`}
                onMouseEnter={() => {
                  if (active !== i) ctrl.audio.ui('hover');
                  setActive(i);
                }}
                onFocus={() => setActive(i)}
                onClick={() => activate(item.id)}
              >
                <span className="idx">0{i + 1}</span>
                <span className="label">{item.label}</span>
                <span className="arrow">→</span>
                <span className="sub">{item.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="car-tag">
        <div className="name">VAYU GT-35</div>
        <div className="paint">{paint.name}</div>
        <div className="spec">Twin-turbo V6 · AWD · 570 PS (simulated)</div>
      </div>
      <div className="menu-footer">
        <div>
          <div style={{ color: 'var(--silver)', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600 }}>
            {district ? district.name : session.district === 'fallback' ? 'Procedural fallback' : 'South Mumbai'} · {TIME_LABEL[settings.timeOfDay]}
            {settings.weather === 'monsoon' ? ' · Monsoon' : ''}
          </div>
          <div style={{ marginTop: 4 }}>
            Map data ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap contributors
            </a>{' '}
            (ODbL)
          </div>
        </div>
        <div className="keys">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> select
          </span>
          <span>
            <kbd>Enter</kbd> confirm
          </span>
        </div>
      </div>
    </>
  );
}
