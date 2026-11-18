import api from '../api/api';

export const authService = {
  async me() {
    const res = await api.get('/auth/me');
    return res.data.user;
  },
  async login({ email, password, organizationId }) {
    const res = await api.post('/auth/login', { email, password, organizationId });
    return res.data.user;
  },
  async signup(payload) {
    const res = await api.post('/auth/signup', payload);
    return res.data.user;
  },
  async logout() {
    await api.post('/auth/logout');
  },
  async previewInvitation(token) {
    const res = await api.post('/auth/invitations/preview', { token });
    return res.data;
  },
  async acceptInvitation({ token, password, name }) {
    const res = await api.post('/auth/invitations/accept', { token, password, name });
    return res.data.user;
  },
};

export default authService;
