import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';

async function enableMocks(): Promise<void> {
  const useMocks =
    import.meta.env.DEV &&
    import.meta.env.VITE_USE_MOCKS !== 'false' &&
    !import.meta.env.VITE_API_BASE_URL;
  if (!useMocks) return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

void enableMocks().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
