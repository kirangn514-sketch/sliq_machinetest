import api from '../api/api';

export const commentService = {
  async list(ticketId) {
    const res = await api.get(`/tickets/${ticketId}/comments`);
    return res.data.comments;
  },
  async create(ticketId, message) {
    const res = await api.post(`/tickets/${ticketId}/comments`, { message });
    return res.data.comment;
  },
};

export default commentService;
