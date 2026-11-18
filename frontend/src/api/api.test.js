/**
 * Unit tests for the Axios instance configuration and interceptors.
 * axios is mocked so we can capture the interceptors and call them directly.
 */
jest.mock('axios', () => {
  const instance = {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return {
    __esModule: true,
    default: { create: jest.fn(() => instance), get: jest.fn() },
    instance,
  };
});

const axios = require('axios');

const { default: api, ApiError, API_BASE_URL } = require('./api');

const createConfig = axios.default.create.mock.calls[0][0];
const requestInterceptor = axios.instance.interceptors.request.use.mock.calls[0][0];
const [onSuccess, onError] = axios.instance.interceptors.response.use.mock.calls[0];

function setCookie(value) {
  document.cookie = `sliqdesk_csrf=${value}; path=/`;
}
function clearCookie() {
  document.cookie = 'sliqdesk_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
}

beforeEach(clearCookie);

describe('axios instance', () => {
  it('is same-origin, versioned and sends cookies', () => {
    expect(api).toBe(axios.instance);
    expect(createConfig).toEqual(expect.objectContaining({ baseURL: '/api/v1', withCredentials: true }));
    expect(API_BASE_URL).toBe('/api/v1');
  });
});

describe('request interceptor (CSRF)', () => {
  it.each(['get', 'head', 'options', undefined])('does not add a CSRF header for %p', async (method) => {
    setCookie('abc');
    const config = await requestInterceptor({ method, headers: {} });
    expect(config.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('echoes the CSRF cookie on state-changing requests', async () => {
    // Arrange
    setCookie('token%20value');
    // Act
    const config = await requestInterceptor({ method: 'post', headers: {} });
    // Assert
    expect(config.headers['X-CSRF-Token']).toBe('token value');
    expect(axios.default.get).not.toHaveBeenCalled();
  });

  it('fetches a CSRF cookie first when none exists', async () => {
    axios.default.get.mockImplementation(async () => { setCookie('fresh'); });
    const config = await requestInterceptor({ method: 'put', headers: {} });
    expect(axios.default.get).toHaveBeenCalledWith('/api/v1/auth/csrf', { withCredentials: true });
    expect(config.headers['X-CSRF-Token']).toBe('fresh');
  });

  it('sends no header if the server did not issue a cookie', async () => {
    axios.default.get.mockResolvedValue({});
    const config = await requestInterceptor({ method: 'delete', headers: {} });
    expect(config.headers['X-CSRF-Token']).toBeUndefined();
  });
});

describe('response interceptor', () => {
  it('unwraps the standard envelope', () => {
    expect(onSuccess({ data: { success: true, data: { a: 1 } } })).toEqual({ success: true, data: { a: 1 } });
  });

  it('normalises API errors into ApiError with field errors', async () => {
    // Arrange
    const err = {
      config: { url: '/tickets' },
      response: {
        status: 400,
        data: {
          message: 'Validation failed', errorCode: 'VALIDATION_ERROR', error: { fields: { title: 'title is required' } },
        },
      },
    };
    // Act
    const rejection = await onError(err).catch((e) => e);
    // Assert
    expect(rejection).toBeInstanceOf(ApiError);
    expect(rejection).toEqual(expect.objectContaining({ status: 400, message: 'Validation failed', errorCode: 'VALIDATION_ERROR' }));
    expect(rejection.fields).toEqual({ title: 'title is required' });
  });

  it('uses a generic message when the body is empty', async () => {
    const rejection = await onError({ config: {}, response: { status: 500, data: null } }).catch((e) => e);
    expect(rejection.message).toBe('Something went wrong');
    expect(rejection.fields).toEqual({});
  });

  it('reports network failures', async () => {
    const rejection = await onError({ message: 'Network Error' }).catch((e) => e);
    expect(rejection).toEqual(expect.objectContaining({ status: 0, errorCode: 'NETWORK_ERROR' }));
  });

  it('broadcasts auth:unauthorized on 401 from business endpoints', async () => {
    const listener = jest.fn();
    window.addEventListener('auth:unauthorized', listener);
    await onError({ config: { url: '/tickets' }, response: { status: 401, data: {} } }).catch(() => {});
    window.removeEventListener('auth:unauthorized', listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each(['/auth/me', '/auth/login'])('does not broadcast for 401 on %s (expected while logged out)', async (url) => {
    const listener = jest.fn();
    window.addEventListener('auth:unauthorized', listener);
    await onError({ config: { url }, response: { status: 401, data: {} } }).catch(() => {});
    window.removeEventListener('auth:unauthorized', listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('handles errors without a request config', async () => {
    const listener = jest.fn();
    window.addEventListener('auth:unauthorized', listener);
    await onError({ response: { status: 401, data: {} } }).catch(() => {});
    window.removeEventListener('auth:unauthorized', listener);
    expect(listener).toHaveBeenCalled();
  });
});
