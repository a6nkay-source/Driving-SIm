import { useEffect, useState } from 'react';
import { appStore } from '../../app/state';
import { useStore } from '../../core/store';

const TIPS = [
  ['Left-hand traffic', 'India drives on the left. Keep left, overtake on the right, and watch for taxis cutting across.'],
  ['Handbrake', 'Tap Space mid-corner to swing the rear out. Steering assist catches the slide for you.'],
  ['Queen’s Necklace', 'Marine Drive’s streetlights curve around Back Bay — switch to Night in the map menu to see them glow.'],
  ['Navigation', 'Pick a destination in the Map menu or click anywhere on the map. Follow the amber route.'],
  ['Cameras', 'Press C to cycle chase, far chase, bonnet and cockpit cameras. The cockpit is right-hand drive.'],
  ['Real streets', 'Roads, buildings and signals come from OpenStreetMap. Flyovers like J. J. Flyover are elevated decks.'],
  ['Stuck?', 'Press R to put the car back on the nearest road, facing the traffic flow.'],
];

export function Loading() {
  const loading = useStore(appStore, (s) => s.loading);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => {
    const id = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 4200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="title">Loading Mumbai</div>
      <div className="label">{loading.label}…</div>
      <div className="bar" aria-label="Loading progress" aria-valuenow={Math.round(loading.progress * 100)} role="progressbar">
        <div style={{ width: `${Math.round(loading.progress * 100)}%` }} />
      </div>
      <div className="tip">
        <b>{TIPS[tip][0]}</b>
        {TIPS[tip][1]}
      </div>
    </div>
  );
}
