import { useEffect, useRef, useState } from 'react';
import { GameController } from '../app/GameController';
import { appStore } from '../app/state';
import { carStore } from '../core/carConfig';
import { settingsStore } from '../core/settings';
import { useStore } from '../core/store';
import { Engine } from '../engine/Engine';
import { ControllerContext } from './context';
import { Hud } from './hud/Hud';
import { About } from './screens/About';
import { Garage } from './screens/Garage';
import { Loading } from './screens/Loading';
import { MainMenu } from './screens/MainMenu';
import { MapScreen } from './screens/MapScreen';
import { PauseMenu } from './screens/PauseMenu';
import { SettingsScreen } from './screens/SettingsScreen';
import { Toasts } from './components/Toasts';

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const [ctrl, setCtrl] = useState<GameController | null>(null);
  const screen = useStore(appStore, (s) => s.screen);
  const error = useStore(appStore, (s) => s.error);
  const webglOk = useStore(appStore, (s) => s.webglOk);

  useEffect(() => {
    if (!Engine.isWebGLAvailable()) {
      appStore.set({ webglOk: false });
      return;
    }
    let c: GameController | null = null;
    try {
      c = new GameController(host.current!);
      setCtrl(c);
      // Debug / automation handle for the console and scripted browser tests.
      Object.assign(window, { __driveMumbai: c, __driveMumbaiStores: { appStore, settingsStore, carStore } });
    } catch (err) {
      console.error(err);
      appStore.set({ webglOk: false, error: `Could not start WebGL: ${(err as Error).message}` });
    }
    return () => {
      c?.dispose();
      setCtrl(null);
    };
  }, []);

  const menuLike = screen === 'menu' || screen === 'garage' || screen === 'settings' || screen === 'about' || screen === 'map' || screen === 'loading';
  const inDrive = screen === 'playing' || screen === 'paused';
  const fromPause = useStore(appStore, (s) => s.returnTo) === 'paused';

  return (
    <div className="app">
      <div className="stage" ref={host} />
      {ctrl && (
        <ControllerContext.Provider value={ctrl}>
          {menuLike && !fromPause && (
            <>
              <div className="vignette" />
              <div className="letterbox" />
              <div className="grain" />
            </>
          )}
          {screen === 'menu' && <MainMenu />}
          {screen === 'garage' && <Garage />}
          {screen === 'map' && <MapScreen />}
          {screen === 'settings' && <SettingsScreen />}
          {screen === 'about' && <About />}
          {screen === 'loading' && <Loading />}
          {inDrive && <Hud />}
          {screen === 'paused' && <PauseMenu />}
        </ControllerContext.Provider>
      )}
      <Toasts />
      {error && (
        <div className="modal-back" role="alertdialog" aria-modal="true">
          <div className="modal panel">
            <h3>Something went wrong</h3>
            <p className="prose">{error}</p>
            <div className="btn-row">
              <button className="btn primary" onClick={() => appStore.set({ error: null })}>
                Dismiss
              </button>
              <button className="btn" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        </div>
      )}
      {!webglOk && (
        <div className="modal-back">
          <div className="modal panel">
            <h3>WebGL is not available</h3>
            <p className="prose">
              Drive Mumbai renders a 3D city with WebGL. Your browser or GPU driver has it disabled. Try a current version of Chrome,
              Edge, Firefox or Safari with hardware acceleration enabled.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
