import { useEffect } from 'react';
import { CALIPERS, carStore, PAINTS, paintById, RIMS, WINGS } from '../../core/carConfig';
import { useStore } from '../../core/store';
import { FLEET, FLEET_ORDER, isVehicleId } from '../../vehicle/fleet';
import { useController } from '../context';
import { BackButton } from '../components/BackButton';

export function Garage() {
  const ctrl = useController();
  const car = useStore(carStore, (s) => s);
  const paint = paintById(car.paint);
  const vehicle = isVehicleId(car.vehicle) ? car.vehicle : 'gtr';
  const spec = FLEET[vehicle];
  const gt = vehicle === 'gtr';
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
            <h2>{gt ? 'Vayu GT-35' : spec.name}</h2>
          </div>
        </div>
        <div className="section" style={{ marginTop: 0 }}>
          <div className="section-title">Vehicle</div>
          <div className="vehicle-picker" role="radiogroup" aria-label="Vehicle">
            {FLEET_ORDER.map((id) => (
              <button key={id} role="radio" aria-checked={vehicle === id} className={`vehicle-card ${vehicle === id ? 'on' : ''}`} onClick={() => set({ vehicle: id })}>
                <span className="glyph" aria-hidden>
                  {id === 'gtr' ? '🏎' : id === 'auto' ? '🛺' : id === 'taxi' ? '🚕' : '🚌'}
                </span>
                <span className="name">{FLEET[id].name}</span>
                <span className="deva">{FLEET[id].nameHi}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="prose" style={{ marginTop: 0 }}>
          {gt ? 'An original twin-turbo AWD coupé inspired by the Nissan GT-R. Every change previews live and is saved for your next drive.' : spec.blurb}
        </p>
        <div className="stat-grid">
          <div className="stat">
            <div className="k">Power</div>
            <div className="v">{spec.specs.power}</div>
          </div>
          <div className="stat">
            <div className="k">Torque</div>
            <div className="v">{spec.specs.torque}</div>
          </div>
          <div className="stat">
            <div className="k">Top speed</div>
            <div className="v">{spec.specs.top}</div>
          </div>
          <div className="stat">
            <div className="k">Layout</div>
            <div className="v" style={{ fontSize: 16 }}>
              {spec.specs.layout}
            </div>
          </div>
        </div>
        <p className="prose" style={{ marginTop: 16, fontSize: 14, color: 'var(--muted)' }}>
          Drag to orbit · scroll to zoom. Figures describe the simulated vehicles, not real ones. In a drive, say or type “drive the bus” to switch on the fly.
        </p>
      </div>

      <div className="side-panel panel right">
        {!gt && (
          <div className="section" style={{ marginTop: 0 }}>
            <div className="section-title">Livery</div>
            <p className="prose" style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
              {vehicle === 'auto'
                ? 'Mumbai autos run in black and yellow on CNG, with a yellow commercial plate and a meter by the handlebar.'
                : vehicle === 'taxi'
                  ? 'The kaali-peeli: black body, yellow roof, chrome bumpers and a roof rack.'
                  : 'BEST red with a cream waistband and an orange LED route board — route 138 to CSMT.'}{' '}
              The paint options below apply to the GT.
            </p>
          </div>
        )}
        <div className="section" style={gt ? { marginTop: 0 } : { opacity: 0.45 }}>
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
