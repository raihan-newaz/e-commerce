import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => {
    if (response.config.method?.toLowerCase() === 'put' && response.config.url?.startsWith('/couriers/configs/')) window.dispatchEvent(new Event('nix:courier-config-updated'));
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      if (window.location.pathname !== '/admin/login') {
        window.dispatchEvent(new Event('nix:session-expired'));
      }
    }
    return Promise.reject(error);
  }
);

export default api;
