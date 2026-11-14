// src/app/main.tsx

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadDeTable } from '../physics/deLoad.js';
import { installMoonLoader } from '../physics/moonLoad.js';
import '@fontsource/michroma/400.css';
import '@fontsource/b612/400.css';
import '@fontsource/b612/700.css';
import '@fontsource/b612-mono/400.css';
import './app.css';

// DE442's Earth and Moon go in before the app is even imported, so nothing
// caches an astronomy-engine position for them first.
// The moons' tables are fetched for the systems the scene has in view.
installMoonLoader();
void loadDeTable().then(async () => {
  const { App } = await import('./App');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
