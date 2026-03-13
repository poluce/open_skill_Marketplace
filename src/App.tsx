import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getAppShellTitle, getHealthPlaceholder, normalizeHealthMessage } from './app/bootstrap';

export function App() {
  const [health, setHealth] = useState(getHealthPlaceholder());

  useEffect(() => {
    invoke<string>('health_check')
      .then((message) => setHealth(normalizeHealthMessage(message)))
      .catch(() => setHealth(getHealthPlaceholder()));
  }, []);

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>{getAppShellTitle()}</h1>
      <p>{health}</p>
    </main>
  );
}
