import { useEffect } from 'react';
import { CALIPERS, carStore, PAINTS, paintById, RIMS, WINGS } from '../../core/carConfig';
import { useStore } from '../../core/store';
import { useController } from '../context';
import { BackButton } from '../components/BackButton';

export function Garage() {
  const ctrl = useController();
  const car = useStore(carStore, (s) => s);
  const paint = paintById(car.paint);
  useEffect(() => ctrl.setMenuMode('garage'), [ctrl]);
  const set = (patch: Partial<typeof car>) => {
    ctrl.audio.ui('click');
    carStore.set(patch);
  };

  return (
    <div className="screen">
      <div className="side-panel panel" style={{ width: 'min(360px, 100%)', alignSelf: 'flex-start' }}>
        <div className="screen-header">
          <BackButton to="menu" />
          <div>
            <div className="crumb">Garage</div>
            <h2>Vayu GT-35</h2>
          </div>
        </div>
        <p className="prose" style={{ marginTop: 0 }}>
          An original twin-turbo AWD coupé inspired by the Nissan GT-R. Every change previews live and is saved for your next drive.
        </p>
        <div className="stat-grid">
          <div className="stat">
            <div className="k">Power</div>
            <div className="v">
              570<small>PS</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">Torque</div>
            <div className="v">
              632<small>N·m</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">0–100</div>
            <div className="v">
              ≈3.0<small>s</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">Top speed</div>
            <div className="v">
              315<small>km/h</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">Drive</div>
            <div className="v">AWD</div>
          </div>
          <div className="stat">
            <div className="k">Gearbox</div>
            <div className="v">
              6<small>DCT</small>
            </div>
          </div>
        </div>
        <p className="prose" style={{ marginTop: 16, fontSize: 14, color: 'var(--muted)' }}>
          Drag the car to orbit · scroll to zoom. Figures describe the simulated car, not a real vehicle.
        </p>
      </div>

      <div className="side-panel panel right">
        <div className="section" style={{ marginTop: 0 }}>
          <div className="section-title">
            Paint <span className="value">{paint.name}</span>
          </div>
          <div className="swatches" role="radiogroup" aria-label="Paint colour">
            {PAINTS.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={car.paint === p.id}
                aria-label={p.name}
                title={`${p.name} (${p.finish})`}
                className={`swatch ${car.paint === p.id ? 'on' : ''}`}
                style={{ background: p.color }}
                onClick={() => set({ paint: p.id })}
              />
            ))}
          </div>
        </div>
        <div className="section">
          <div className="section-title">
            Wheels <span className="value">{RIMS.find((r) => r.id === car.rims)?.name}</span>
          </div>
          <div className="chips">
            {RIMS.map((r) => (
              <button key={r.id} className={`chip ${car.rims === r.id ? 'on' : ''}`} onClick={() => set({ rims: r.id })}>
                {r.name}
              </button>
            ))}
          </div>
        </div>
        <div className="section">
          <div className="section-title">Brake calipers</div>
          <div className="chips">
            {CALIPERS.map((c) => (
              <button key={c.id} className={`chip ${car.caliper === c.id ? 'on' : ''}`} onClick={() => set({ caliper: c.id })}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: c.color, marginRight: 8 }} />
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="section">
          <div className="section-title">Aero</div>
          <div className="chips">
            {WINGS.map((w) => (
              <button key={w.id} className={`chip ${car.wing === w.id ? 'on' : ''}`} onClick={() => set({ wing: w.id })}>
                {w.name}
              </button>
            ))}
          </div>
        </div>
        <div className="section">
          <div className="section-title">
            Window tint <span className="value">{Math.round(car.tint * 100)}%</span>
          </div>
          <input className="range" type="range" min={0} max={1} step={0.05} value={car.tint} onChange={(e) => carStore.set({ tint: Number(e.target.value) })} />
        </div>
        <div className="section">
          <div className="section-title">Registration plate</div>
          <input
            className="text-input"
            maxLength={13}
            value={car.plate}
            onChange={(e) => carStore.set({ plate: e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '') || 'MH 01' })}
            aria-label="Registration plate text"
          />
        </div>
        <div className="btn-row">
          <button className="btn primary" onClick={() => void ctrl.play()}>
            Drive
          </button>
          <button className="btn ghost" onClick={() => set({ paint: 'gun-metallic', rims: 'gunmetal', caliper: 'amber', wing: 'stock', tint: 0.7, plate: 'MH 01 GT 3535' })}>
            Reset to factory
          </button>
        </div>
      </div>
    </div>
  );
}
