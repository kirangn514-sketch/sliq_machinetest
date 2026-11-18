import api from '../api/api';

/** Removes empty filter values so the URL only carries active filters. */
function cleanParams(params) {
  return Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined));
}

export const ticketService = {
  async list(params) {
    const res = await api.get('/tickets', { params: cleanParams(params) });
    return res.data; // { items, pagination }
  },
  async stats() {
    const res = await api.get('/tickets/stats');
    return res.data.stats;
  },
  async get(id) {
    const res = await api.get(`/tickets/${id}`);
    return res.data.ticket;
  },
  async create(payload) {
    const res = await api.post('/tickets', payload);
    return res.data.ticket;
  },
  async update(id, changes) {
    const res = await api.put(`/tickets/${id}`, changes);
    return res.data.ticket;
  },
};

export default ticketService;
