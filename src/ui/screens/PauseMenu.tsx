import { useEffect, useState } from 'react';
import { appStore } from '../../app/state';
import { settingsStore } from '../../core/settings';
import { useController } from '../context';

export function PauseMenu() {
  const ctrl = useController();
  const [confirmQuit, setConfirmQuit] = useState(false);
  const t = ctrl.drive?.telemetry;
  const units = settingsStore.get().units;
  useEffect(() => {
    ctrl.audio.ui('back');
  }, [ctrl]);
  const items: [string, string, () => void][] = [
    ['Resume', 'Back to the road', () => ctrl.resume()],
    ['Restart', 'Return to the start point', () => ctrl.restart()],
    [
      'Map',
      'Destination · route · district',
      () => {
        appStore.set({ returnTo: 'paused' });
        ctrl.navigate('map');
      },
    ],
    [
      'Settings',
      'Graphics · audio · controls',
      () => {
        appStore.set({ returnTo: 'paused' });
        ctrl.navigate('settings');
      },
    ],
    ['Quit to menu', 'Leave this drive', () => setConfirmQuit(true)],
  ];
  const km = (t?.odometer ?? 0) / 1000;
  const dist = units === 'mph' ? `${(km * 0.621371).toFixed(2)} mi` : `${km.toFixed(2)} km`;
  const mins = Math.floor((t?.elapsed ?? 0) / 60);
  const secs = Math.floor((t?.elapsed ?? 0) % 60);
  return (
    <div className="pause" role="dialog" aria-modal="true" aria-label="Paused">
      <div className="pause-card panel">
        <h2>Paused</h2>
        <div className="meta">
          {dist} driven · {mins}:{String(secs).padStart(2, '0')} on the road
          {t?.roadName ? ` · ${t.roadName}` : ''}
        </div>
        {!confirmQuit ? (
          <div className="menu-list">
            {items.map(([label, sub, fn], i) => (
              <button
                key={label}
                className={`menu-btn ${i === 0 ? 'primary' : ''}`}
                autoFocus={i === 0}
                onMouseEnter={() => ctrl.audio.ui('hover')}
                onClick={() => {
                  ctrl.audio.ui('click');
                  fn();
                }}
              >
                <span className="idx">0{i + 1}</span>
                <span className="label">{label}</span>
                <span className="arrow">→</span>
                <span className="sub">{sub}</span>
              </button>
            ))}
          </div>
        ) : (
          <div>
            <p className="prose">Leave this drive and return to the main menu? Your distance will reset.</p>
            <div className="btn-row">
              <button className="btn primary" autoFocus onClick={() => ctrl.quitToMenu()}>
                Quit
              </button>
              <button className="btn" onClick={() => setConfirmQuit(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <p className="prose" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, marginBottom: 0 }}>
          Press <kbd>Esc</kbd> to resume
        </p>
      </div>
    </div>
  );
}
