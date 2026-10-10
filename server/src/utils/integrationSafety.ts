import axios from 'axios';
import { config } from '../config';

// Fail closed for cloned-data testing, including clients created with axios.create().
export function installIntegrationSafety() {
  if (config.integrationsEnabled) return;
  const block = () => { throw new Error('External integrations are disabled in this environment'); };
  axios.interceptors.request.use(block);
  const create = axios.create.bind(axios);
  axios.create = (...args) => {
    const client = create(...args);
    client.interceptors.request.use(block);
    return client;
  };
}
