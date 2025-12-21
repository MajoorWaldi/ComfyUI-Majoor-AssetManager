// Dedicated shared global state container (no dependencies to avoid cycles)
export const mjrGlobalState = {
  instances: new Set(),
};
