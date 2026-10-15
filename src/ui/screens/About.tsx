import { useEffect } from 'react';
import { appStore } from '../../app/state';
import { useStore } from '../../core/store';
import { BackButton } from '../components/BackButton';
import { useController } from '../context';

export function About() {
  const ctrl = useController();
  const districts = useStore(appStore, (s) => s.districts);
  useEffect(() => ctrl.setMenuMode('about'), [ctrl]);
  return (
    <div className="screen">
      <div className="side-panel panel" style={{ width: 'min(640px, 100%)' }}>
        <div className="screen-header">
          <BackButton to="menu" />
          <div>
            <div className="crumb">About</div>
            <h2>Drive Mumbai</h2>
          </div>
        </div>
        <div className="prose">
          <p>
            An open-world driving game that runs in your browser. The streets, flyovers, coastline, parks, traffic signals, bus stops and building
            footprints are imported from OpenStreetMap and rebuilt in 3D. Building heights come from OSM tags where mapped, and are otherwise
            estimated, so the skyline is an approximation of the real city.
          </p>
          <h3>Map coverage</h3>
          {districts.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {districts.map((d) => (
                <li key={d.id}>
                  <b>{d.name}</b> — {d.roadKm} km of drivable road, {d.buildings.toLocaleString()} buildings. {d.blurb}
                </li>
              ))}
            </ul>
          ) : (
            <p>No imported districts were found, so the game will use its procedural fallback district (a fictional map).</p>
          )}
          <p style={{ marginTop: 10 }}>
            Areas outside these districts are not mapped. A procedural fallback district (clearly marked as fictional) is used if map data cannot be
            loaded.
          </p>
          <h3>Data &amp; licences</h3>
          <p>
            Map data ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap contributors
            </a>
            , available under the{' '}
            <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">
              Open Database License (ODbL 1.0)
            </a>
            . The processed map files shipped with the game are a derivative database under the same licence.
          </p>
          <p>
            The car model, textures, road signs and all audio are generated procedurally by this project’s own code — no third-party models,
            images or sound recordings are used. Fonts: Michroma and Rajdhani (SIL Open Font License), bundled via Fontsource. Rendering by
            three.js (MIT); UI by React (MIT).
          </p>
          <h3>Disclaimer</h3>
          <p>
            The “Vayu GT-35” is an original design inspired by the Nissan GT-R. It is not affiliated with, endorsed by, or a model of any Nissan
            product. Nissan and GT-R are trademarks of their respective owner. Drive responsibly — in real Mumbai, the speed limit on Marine Drive
            is far below what this car can do.
          </p>
        </div>
      </div>
    </div>
  );
}
