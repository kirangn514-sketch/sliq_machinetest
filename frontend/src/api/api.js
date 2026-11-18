import axios from 'axios';

/**
 * Single Axios instance for the whole app.
 *  - Same-origin base URL (Nginx / Vite proxy forward /api to the backend)
 *  - withCredentials so the HttpOnly auth cookie is sent
 *  - CSRF double-submit header on state-changing requests
 *  - Errors normalised to ApiError; 401s broadcast so AuthContext can sign the user out
 */
export const API_BASE_URL = '/api/v1';
const CSRF_COOKIE = 'sliqdesk_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

export class ApiError extends Error {
  constructor({ status, message, errorCode, details }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.details = details || null;
    this.fields = (details && details.fields) || {};
  }
}

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

function readCookie(name) {
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

async function ensureCsrfToken() {
  let token = readCookie(CSRF_COOKIE);
  if (!token) {
    await axios.get(`${API_BASE_URL}/auth/csrf`, { withCredentials: true });
    token = readCookie(CSRF_COOKIE);
  }
  return token;
}

api.interceptors.request.use(async (config) => {
  const method = (config.method || 'get').toLowerCase();
  if (!['get', 'head', 'options'].includes(method)) {
    const token = await ensureCsrfToken();
    if (token) config.headers[CSRF_HEADER] = token;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response.data, // the standard envelope { success, message, data, ... }
  (error) => {
    if (!error.response) {
      return Promise.reject(new ApiError({
        status: 0, message: 'Cannot reach the server. Check your connection.', errorCode: 'NETWORK_ERROR',
      }));
    }
    const { status, data } = error.response;
    const apiError = new ApiError({
      status,
      message: (data && data.message) || 'Something went wrong',
      errorCode: data && data.errorCode,
      details: data && data.error,
    });
    const url = error.config && error.config.url;
    if (status === 401 && url !== '/auth/me' && url !== '/auth/login') {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    return Promise.reject(apiError);
  },
);

export default api;
