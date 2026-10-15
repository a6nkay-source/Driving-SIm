import '@fontsource/michroma/400.css';
import '@fontsource/rajdhani/400.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import './styles/global.css';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ensureFirstRunDefaults } from './core/settings';

ensureFirstRunDefaults();
createRoot(document.getElementById('root')!).render(<App />);
