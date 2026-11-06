import React from 'react';
import ReactDOM from 'react-dom/client';
import { Dashboard } from './Dashboard';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <Dashboard />
    </React.StrictMode>
  );
}
