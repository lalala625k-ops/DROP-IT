import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BrowserMigration } from './components/BrowserMigration';
import './index.css';

async function mountApp() {
  // Card sizes are measured during initialization. Load the real faces first
  // so fallback glyph widths cannot become saved card dimensions.
  if ('fonts' in document) {
    await Promise.allSettled([400, 500, 700, 900].flatMap((weight) => [
      document.fonts.load(`${weight} 15px "ISOCP_IV50"`, 'DropIt'),
      document.fonts.load(`${weight} 15px "Lil Grotesk"`, 'DropIt'),
      document.fonts.load(`${weight} 15px "OPPO Sans"`, '中文'),
    ]));
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {new URLSearchParams(location.search).has('migrate') ? <BrowserMigration /> : <App />}
    </React.StrictMode>
  );
}

void mountApp();
