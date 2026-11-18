import api from '../api/api';

export const memberService = {
  /** Admin only: members + pending invitations. */
  async list() {
    const res = await api.get('/members');
    return res.data;
  },
  /** Any role: id/name/role for assignee pickers and filters. */
  async directory() {
    const res = await api.get('/members/directory');
    return res.data.members;
  },
  async invite(payload) {
    const res = await api.post('/members', payload);
    return res.data; // { invitation, invitationUrl? }
  },
  async changeRole(id, role) {
    const res = await api.put(`/members/${id}/role`, { role });
    return res.data;
  },
  async remove(id) {
    const res = await api.delete(`/members/${id}`);
    return res.data;
  },
  async revokeInvitation(id) {
    const res = await api.delete(`/members/invitations/${id}`);
    return res.data;
  },
};

export default memberService;
