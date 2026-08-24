import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@builtbyted/react/styles.css';
import './styles.css';
import { App } from './App.js';

const root = document.getElementById('homeframe-root');
if (!root) throw new Error('Missing #homeframe-root.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
