/**
 * Bridges the React UI and the imperative engine: owns the renderer, the menu
 * and drive scenes, input and audio, and implements every menu action.
 */
import { AudioEngine } from '../audio/AudioEngine';
import { Voice } from '../audio/Voice';
import { parseCommand } from '../commands/CommandParser';
import { VoiceCommands } from '../commands/VoiceCommands';
import { settingsStore, type Settings } from '../core/settings';
import type { DriveScene } from '../drive/DriveScene';
import { Engine } from '../engine/Engine';
import { Input } from '../input/Input';
import { loadMapIndex } from '../map/MapData';
import { MenuScene, type MenuMode } from '../menu/MenuScene';
import { appStore, commandStore, go, toast, type Screen } from './state';

export class GameController {
  readonly engine: Engine;
  readonly input: Input;
  readonly audio: AudioEngine;
  readonly voice = new Voice();
  readonly listener = new VoiceCommands();
  private menu: MenuScene | null = null;
  drive: DriveScene | null = null;
  private loadToken = 0;
  private unsub: (() => void)[] = [];

  constructor(host: HTMLElement) {
    this.engine = new Engine(host, settingsStore.get());
    this.input = new Input(window);
    this.audio = new AudioEngine();
    this.menu = new MenuScene(this.engine.renderer);
    this.engine.setScene(this.menu);
    this.engine.start();
    this.engine.onContextLost = () => {
      appStore.set({ error: 'The graphics context was lost (GPU reset). Reload the page to continue.' });
    };
    this.unsub.push(
      settingsStore.subscribe(() => {
        const s = settingsStore.get();
        this.engine.applySettings(s);
        this.audio.applySettings(s);
        this.applyVoiceSettings(s);
        this.drive?.applySettings(s);
      }),
    );
    this.audio.applySettings(settingsStore.get());
    this.applyVoiceSettings(settingsStore.get());
    this.listener.onResult = (text) => {
      const r = this.runCommand(text);
      commandStore.set({ reply: r.reply, replyOk: r.ok, heard: text });
    };
    // Pause / back key handling outside of driving.
    this.engine.onFrame = () => this.handleGlobalKeys();
    // Any key or click is a user gesture: use it to (re)start blocked audio.
    const retryAudio = () => {
      if (appStore.get().audioBlocked) this.unlockAudio();
    };
    window.addEventListener('keydown', retryAudio);
    window.addEventListener('pointerdown', retryAudio);
    this.unsub.push(() => {
      window.removeEventListener('keydown', retryAudio);
      window.removeEventListener('pointerdown', retryAudio);
    });
    void loadMapIndex().then((districts) => appStore.set({ districts }));
  }

  private applyVoiceSettings(s: Settings): void {
    this.voice.pack = s.voicePack;
    this.voice.captions = s.captions;
    this.voice.volume = s.voiceVolume * s.masterVolume;
    this.voice.muted = s.muted;
    this.listener.lang = s.voiceLang;
  }

  /** Parses and runs a typed or spoken command. */
  runCommand(text: string): { ok: boolean; reply: string } {
    const drive = this.drive;
    if (!drive) return { ok: false, reply: 'Start a drive first.' };
    const cmd = parseCommand(text, drive.places);
    if (!cmd) return { ok: false, reply: `Didn't catch that — try “go to Victoria Terminus” or “add a rickshaw”.` };
    return drive.execute(cmd);
  }

  openCommandBar(): void {
    if (appStore.get().screen !== 'playing') return;
    this.input.releaseAll();
    commandStore.set({ open: true });
  }

  closeCommandBar(): void {
    commandStore.set({ open: false });
    this.input.releaseAll();
    this.engine.renderer.domElement.focus();
  }

  /** Starts or stops listening for a spoken command (must follow a user gesture). */
  toggleListening(): void {
    if (this.listener.listening) {
      this.listener.stop();
      return;
    }
    this.unlockAudio();
    this.voice.stop();
    this.listener.start();
  }

  private handleGlobalKeys(): void {
    const screen = appStore.get().screen;
    if (screen === 'playing') {
      if (this.input.consume('command')) this.openCommandBar();
      if (this.input.consume('voice')) this.toggleListening();
      if (this.input.consume('pause')) this.pause();
      if (this.input.consume('map')) {
        this.pause();
        appStore.set({ screen: 'map', returnTo: 'paused' });
      }
    } else if (screen === 'paused') {
      if (this.input.consume('pause')) this.resume();
    } else {
      this.input.clearPressed();
    }
  }

  setMenuMode(mode: MenuMode): void {
    this.menu?.setMode(mode);
  }

  previewShot(i: number | null): void {
    this.menu?.previewShot(i);
  }

  /** Must be called from a user gesture (click) so the browser lets audio start. */
  unlockAudio(): void {
    void this.audio.unlock().then((ok) => appStore.set({ audioBlocked: !ok }));
  }

  async play(): Promise<void> {
    const token = ++this.loadToken;
    this.unlockAudio();
    go('loading');
    this.menu?.setMode('loading');
    appStore.set({ loading: { progress: 0, label: 'Starting engine' }, error: null });
    try {
      const { DriveScene } = await import('../drive/DriveScene');
      if (token !== this.loadToken) return;
      const session = appStore.get().session;
      const scene = new DriveScene(this.engine, this.input, this.audio, settingsStore.get(), this.voice);
      await scene.load(session, (progress, label) => {
        if (token === this.loadToken) appStore.set({ loading: { progress, label } });
      });
      if (token !== this.loadToken) {
        scene.dispose();
        return;
      }
      this.disposeDrive();
      this.drive = scene;
      this.engine.setScene(scene);
      this.disposeMenu();
      this.input.enabled = true;
      this.input.releaseAll();
      this.engine.renderer.domElement.focus();
      go('playing');
      if (scene.map?.fallback) {
        if (session.district === 'fallback') toast('Procedural district — a fictional map, not real Mumbai streets', 'info', 4500);
        else toast(`Real map data unavailable (${scene.map.fallbackReason ?? 'unknown error'}). Driving the procedural fallback district instead.`, 'warn', 8000);
      }
    } catch (err) {
      console.error(err);
      appStore.set({ error: `Could not start the drive: ${(err as Error).message}` });
      this.quitToMenu();
    }
  }

  pause(): void {
    if (!this.drive) return;
    this.listener.stop();
    commandStore.set({ open: false });
    this.drive.setPaused(true);
    this.input.enabled = false;
    this.input.releaseAll();
    go('paused');
  }

  resume(): void {
    if (!this.drive) return;
    this.drive.setPaused(false);
    this.input.enabled = true;
    this.input.releaseAll();
    this.engine.renderer.domElement.focus();
    go('playing');
  }

  /** Re-applies the session (destination, mode) to the running drive. */
  applySessionToDrive(): void {
    this.drive?.applySession(appStore.get().session);
  }

  restart(): void {
    this.drive?.respawn(true);
    this.resume();
  }

  quitToMenu(): void {
    this.loadToken++;
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.stopDrive();
    if (!this.menu) {
      this.menu = new MenuScene(this.engine.renderer);
    }
    this.menu.setMode('menu');
    this.engine.setScene(this.menu);
    this.disposeDrive();
    go('menu');
  }

  navigate(screen: Screen): void {
    const s = appStore.get().screen;
    if (screen === 'settings' || screen === 'map') appStore.set({ returnTo: s === 'paused' ? 'paused' : 'menu' });
    go(screen);
    if (screen === 'menu' || screen === 'garage' || screen === 'settings' || screen === 'about' || screen === 'map') {
      this.menu?.setMode(screen);
    }
  }

  private disposeDrive(): void {
    if (this.drive) {
      this.drive.dispose();
      this.drive = null;
    }
  }

  private disposeMenu(): void {
    if (this.menu) {
      this.menu.dispose();
      this.menu = null;
    }
  }

  dispose(): void {
    this.listener.stop();
    this.voice.stop();
    this.unsub.forEach((u) => u());
    this.disposeDrive();
    this.disposeMenu();
    this.input.dispose();
    this.audio.dispose();
    this.engine.dispose();
  }
}
