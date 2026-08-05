import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { defaultDataMode, selectCommonsClient } from './data/mode';
import './styles/tokens.css';

const configuredMode = import.meta.env.VITE_COMMONS_DATA_MODE ?? defaultDataMode(import.meta.env.PROD);
const client = selectCommonsClient(configuredMode);

createRoot(document.getElementById('root')!).render(<StrictMode><App client={client} /></StrictMode>);
