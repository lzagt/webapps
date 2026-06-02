import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="aacal-theme min-h-screen bg-background text-on-background">
        <App />
      </div>
    </BrowserRouter>
  </React.StrictMode>
);
