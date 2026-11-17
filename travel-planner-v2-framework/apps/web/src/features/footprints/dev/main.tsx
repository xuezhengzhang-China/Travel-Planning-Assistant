import React from 'react';
import { createRoot } from 'react-dom/client';
import FootprintMapDevPage from './FootprintMapDevPage';
import '../../../style.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FootprintMapDevPage />
  </React.StrictMode>,
);
