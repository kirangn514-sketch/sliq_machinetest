import api from '../api/api';

export const notificationService = {
  async list(params = { page: 1, limit: 10 }) {
    const res = await api.get('/notifications', { params });
    return res.data; // { items, unreadCount, pagination }
  },
  async markRead(id) {
    const res = await api.patch(`/notifications/${id}/read`);
    return res.data;
  },
  async markAllRead() {
    const res = await api.patch('/notifications/read-all');
    return res.data;
  },
};

export default notificationService;
