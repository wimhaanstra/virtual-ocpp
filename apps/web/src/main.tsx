import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@awesome.me/webawesome/dist/styles/webawesome.css';
import './styles/index.scss';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
