import api from '../api/api';

export const settingsService = {
  async getSla() {
    const res = await api.get('/settings/sla');
    return res.data.sla;
  },
  async updateSla(responseTimeMinutes) {
    const res = await api.put('/settings/sla', { responseTimeMinutes });
    return res.data.sla;
  },
};

export default settingsService;
