import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { PmsProvider } from './context/PmsContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PmsProvider>
      <App />
    </PmsProvider>
  </React.StrictMode>
);
