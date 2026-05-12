const listeners = new Set();
export const state = {
  user: null,            // { uid, email, role, displayName }
  meta: null,            // { calendarioSemanal: {...} }
  obras: {},             // dict obraId → { meta } (todas, para selector multi-obra en empleados/gastos)
  empleados: null,       // cache opcional
  loading: false
};

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach(fn => fn(state));
}

export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
