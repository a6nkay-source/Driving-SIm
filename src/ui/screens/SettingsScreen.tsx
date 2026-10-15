import { useEffect, useState, type ReactNode } from 'react';
import { applyQualityPreset, DEFAULT_SETTINGS, settingsStore, type CameraMode, type Quality, type Settings } from '../../core/settings';
import { useStore } from '../../core/store';
import { BackButton } from '../components/BackButton';
import { useController } from '../context';

type Tab = 'graphics' | 'audio' | 'controls' | 'world';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div>
        <label>{label}</label>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

function Slider({ value, min, max, step, onChange, format, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; label: string }) {
  return (
    <>
      <input className="range" type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{format(value)}</output>
    </>
  );
}

function Chips<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="chips" style={{ justifyContent: 'flex-end' }}>
      {options.map(([v, l]) => (
        <button key={String(v)} className={`chip ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function SettingsScreen() {
  const ctrl = useController();
  const s = useStore(settingsStore, (x) => x);
  const [tab, setTab] = useState<Tab>('graphics');
  useEffect(() => ctrl.setMenuMode('settings'), [ctrl]);
  const set = (patch: Partial<Settings>) => settingsStore.set(patch);

  return (
    <div className="screen">
      <div className="side-panel panel" style={{ width: 'min(620px, 100%)' }}>
        <div className="screen-header">
          <BackButton />
          <div>
            <div className="crumb">Options</div>
            <h2>Settings</h2>
          </div>
        </div>
        <div className="tabs" role="tablist">
          {(['graphics', 'audio', 'controls', 'world'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'graphics' && (
          <div>
            <Row label="Quality preset" hint="Sets resolution, shadows, bloom and draw distance">
              <Chips<Quality>
                value={s.quality}
                options={[
                  ['low', 'Low'],
                  ['medium', 'Medium'],
                  ['high', 'High'],
                  ['ultra', 'Ultra'],
                ]}
                onChange={applyQualityPreset}
              />
            </Row>
            <Row label="Render scale" hint="Lower for more FPS on laptops">
              <Slider label="Render scale" value={s.renderScale} min={0.5} max={1} step={0.05} onChange={(v) => set({ renderScale: v })} format={pct} />
            </Row>
            <Row label="Shadows">
              <Toggle label="Shadows" on={s.shadows} onChange={(v) => set({ shadows: v })} />
            </Row>
            <Row label="Bloom / glow" hint="Street lights, neon signs and headlights">
              <Toggle label="Bloom" on={s.bloom} onChange={(v) => set({ bloom: v })} />
            </Row>
            <Row label="View distance" hint="City tiles streamed around the car">
              <Slider label="View distance" value={s.viewDistance} min={300} max={1600} step={50} onChange={(v) => set({ viewDistance: v })} format={(v) => `${v} m`} />
            </Row>
            <Row label="Traffic density">
              <Chips<number>
                value={s.trafficDensity}
                options={[
                  [0, 'Off'],
                  [1, 'Light'],
                  [2, 'Normal'],
                  [3, 'Heavy'],
                ]}
                onChange={(v) => set({ trafficDensity: v })}
              />
            </Row>
            <Row label="Show FPS">
              <Toggle label="Show FPS" on={s.showFps} onChange={(v) => set({ showFps: v })} />
            </Row>
          </div>
        )}

        {tab === 'audio' && (
          <div>
            <Row label="Master volume">
              <Slider label="Master volume" value={s.masterVolume} min={0} max={1} step={0.05} onChange={(v) => set({ masterVolume: v })} format={pct} />
            </Row>
            <Row label="Engine">
              <Slider label="Engine volume" value={s.engineVolume} min={0} max={1} step={0.05} onChange={(v) => set({ engineVolume: v })} format={pct} />
            </Row>
            <Row label="Effects" hint="Tyres, horn, impacts">
              <Slider label="Effects volume" value={s.effectsVolume} min={0} max={1} step={0.05} onChange={(v) => set({ effectsVolume: v })} format={pct} />
            </Row>
            <Row label="City ambience" hint="Traffic, horns, sea, rain">
              <Slider label="Ambience volume" value={s.ambienceVolume} min={0} max={1} step={0.05} onChange={(v) => set({ ambienceVolume: v })} format={pct} />
            </Row>
            <Row label="Mute all" hint="Shortcut: M">
              <Toggle label="Mute" on={s.muted} onChange={(v) => set({ muted: v })} />
            </Row>
            <p className="prose" style={{ fontSize: 14, color: 'var(--muted)', marginTop: 14 }}>
              All sounds are synthesised in real time with the Web Audio API. Browsers only start audio after you click or press a key.
            </p>
          </div>
        )}

        {tab === 'controls' && (
          <div>
            <Row label="Steering sensitivity">
              <Slider label="Steering sensitivity" value={s.steeringSensitivity} min={0.5} max={1.6} step={0.05} onChange={(v) => set({ steeringSensitivity: v })} format={(v) => `${v.toFixed(2)}×`} />
            </Row>
            <Row label="Steering assist" hint="Counter-steers to catch slides">
              <Toggle label="Steering assist" on={s.steeringAssist} onChange={(v) => set({ steeringAssist: v })} />
            </Row>
            <Row label="Camera" hint="Shortcut: C">
              <Chips<CameraMode>
                value={s.camera}
                options={[
                  ['chase', 'Chase'],
                  ['far', 'Far'],
                  ['hood', 'Bonnet'],
                  ['cockpit', 'Cockpit'],
                ]}
                onChange={(v) => set({ camera: v })}
              />
            </Row>
            <Row label="Speed units">
              <Chips<'kmh' | 'mph'>
                value={s.units}
                options={[
                  ['kmh', 'km/h'],
                  ['mph', 'mph'],
                ]}
                onChange={(v) => set({ units: v })}
              />
            </Row>
            <div className="section">
              <div className="section-title">Keyboard</div>
              <div className="controls-table prose">
                <span><kbd>W</kbd><kbd>↑</kbd></span><span>Accelerate</span>
                <span><kbd>S</kbd><kbd>↓</kbd></span><span>Brake · hold when stopped to reverse</span>
                <span><kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd></span><span>Steer</span>
                <span><kbd>Space</kbd></span><span>Handbrake</span>
                <span><kbd>C</kbd></span><span>Switch camera</span>
                <span><kbd>H</kbd></span><span>Horn</span>
                <span><kbd>L</kbd></span><span>Headlights</span>
                <span><kbd>M</kbd></span><span>Mute audio</span>
                <span><kbd>R</kbd></span><span>Reset car onto the road</span>
                <span><kbd>Tab</kbd></span><span>Map &amp; destinations</span>
                <span><kbd>Esc</kbd></span><span>Pause</span>
              </div>
              <p className="prose" style={{ fontSize: 14, color: 'var(--muted)' }}>Gamepads work too: triggers for throttle/brake, left stick to steer, A handbrake, Y camera, B horn.</p>
            </div>
          </div>
        )}

        {tab === 'world' && (
          <div>
            <Row label="Time of day">
              <Chips<Settings['timeOfDay']>
                value={s.timeOfDay}
                options={[
                  ['day', 'Day'],
                  ['sunset', 'Sunset'],
                  ['night', 'Night'],
                ]}
                onChange={(v) => set({ timeOfDay: v })}
              />
            </Row>
            <Row label="Weather" hint="Monsoon adds rain, wet roads and less grip">
              <Chips<Settings['weather']>
                value={s.weather}
                options={[
                  ['clear', 'Clear'],
                  ['monsoon', 'Monsoon'],
                ]}
                onChange={(v) => set({ weather: v })}
              />
            </Row>
          </div>
        )}

        <div className="btn-row">
          <button className="btn ghost" onClick={() => settingsStore.set({ ...DEFAULT_SETTINGS })}>
            Restore defaults
          </button>
        </div>
      </div>
    </div>
  );
}
