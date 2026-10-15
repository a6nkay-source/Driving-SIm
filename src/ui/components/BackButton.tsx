import { useEffect } from 'react';
import { appStore, type Screen } from '../../app/state';
import { useController } from '../context';

/** Back arrow that also responds to Escape. */
export function BackButton({ to, label = 'Back' }: { to?: Screen; label?: string }) {
  const ctrl = useController();
  const back = () => {
    ctrl.audio.ui('back');
    const target = to ?? appStore.get().returnTo;
    appStore.set({ returnTo: 'menu' });
    ctrl.navigate(target);
    // The same Escape press must not also resume the drive on the next frame.
    ctrl.input.clearPressed();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <button className="btn" onClick={back} aria-label={label} title={`${label} (Esc)`} style={{ padding: '10px 12px' }}>
      ←
    </button>
  );
}
