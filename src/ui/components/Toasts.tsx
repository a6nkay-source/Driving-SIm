import { appStore } from '../../app/state';
import { useStore } from '../../core/store';

export function Toasts() {
  const toasts = useStore(appStore, (s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
