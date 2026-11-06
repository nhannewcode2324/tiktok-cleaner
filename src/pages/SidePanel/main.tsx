import React from 'react';
import ReactDOM from 'react-dom/client';
import { SidePanel } from './SidePanel';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <SidePanel />
    </React.StrictMode>
  );
}
