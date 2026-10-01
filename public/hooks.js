// Late-bound callbacks so page modules can refresh the shell without circular imports.
export const hooks = {
  refresh: async () => {},
  render: () => {},
  openOrder: () => {},
  reloadOrders: () => {},
  openTicket: () => {},
  leaveTicket: () => {},
};
