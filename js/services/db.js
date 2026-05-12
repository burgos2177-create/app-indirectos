import {
  ref, get, set, update, push, remove, onValue, off
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';
import { db } from './firebase.js';
import { APP_BASE_PATH } from '../config/firebase-config.js';

// Prefija toda path relativa con APP_BASE_PATH. Para escapes (rutas absolutas
// como /legacy/estimaciones/users, /shared/catalogos, /shared/buzon,
// /legacy/bitacora/*) pasar el path comenzando con "/" — se interpreta como
// absoluto.
function _resolve(path) {
  if (typeof path !== 'string') throw new Error('path debe ser string');
  if (path.startsWith('/')) return path.slice(1);
  return APP_BASE_PATH ? `${APP_BASE_PATH}/${path}` : path;
}

export function appPath(relPath) { return _resolve(relPath); }

function _ref(path) {
  const resolved = _resolve(path);
  return resolved ? ref(db, resolved) : ref(db);
}

export function rread(path) {
  return get(_ref(path)).then(s => s.exists() ? s.val() : null);
}
export function rset(path, val) { return set(_ref(path), val); }
export function rupdate(path, patch) { return update(_ref(path), patch); }
export function rpush(path, val) {
  const r = push(_ref(path));
  return set(r, val).then(() => r.key);
}
export function rremove(path) { return remove(_ref(path)); }
export function rwatch(path, cb) {
  const r = _ref(path);
  const handler = onValue(r, s => cb(s.exists() ? s.val() : null));
  return () => off(r, 'value', handler);
}

// === Usuarios y obras (lectura a /legacy/estimaciones — fuente única) ===

export async function listUsersLegacy() {
  return (await rread('/legacy/estimaciones/users')) || {};
}
export async function getUserProfileLegacy(uid) {
  return await rread(`/legacy/estimaciones/users/${uid}`);
}
export async function listObrasLegacy() {
  return (await rread('/legacy/estimaciones/obras')) || {};
}
export async function getObraMetaLegacy(obraId) {
  return await rread(`/legacy/estimaciones/obras/${obraId}/meta`);
}

// === Catálogo OPUS (solo lectura) ===
//
// Indirectos lee el catálogo de conceptos cuando un gasto se carga a una
// obra con conceptoKey específico. Si el gasto va con bandera
// sin_desglose_opus=true, no toca esto.
export async function loadCatalogoConceptos(obraId) {
  const shared = await rread(`/shared/catalogos/${obraId}`);
  if (!shared?.conceptos) return null;
  return { meta: shared.meta, conceptos: shared.conceptos };
}

// === Mapping obra → proyecto contable (para que bitácora resuelva al aprobar) ===
export async function getProyectoIdByObraId(obraId) {
  if (!obraId) return null;
  return await rread(`/shared/obraLinks/${obraId}`);
}

// === Buzón cross-app ===
//
// /shared/buzon es el bus de aprobación. Indirectos publica:
//   - nomina_operativo_semana
//   - nomina_tecnico_campo_quincena
//   - nomina_tecnico_oficina_quincena
//   - nomina_directivo_quincena
//   - nomina_individual
//   - gasto_indirecto
// Bitácora consume y aprueba (genera sogrub_movimientos y/o sogrub_proy_movimientos).
export async function listBuzon() {
  return (await rread('/shared/buzon')) || {};
}
export function watchBuzon(cb) {
  return rwatch('/shared/buzon', cb);
}
export async function getBuzonItem(itemId) {
  return await rread(`/shared/buzon/${itemId}`);
}
export async function pushBuzonItem(item) {
  return rpush('/shared/buzon', { ...item, creadoAt: Date.now() });
}
export async function updateBuzonItem(itemId, patch) {
  return rupdate(`/shared/buzon/${itemId}`, { ...patch, actualizadoAt: Date.now() });
}
export async function deleteBuzonItem(itemId) {
  return rremove(`/shared/buzon/${itemId}`);
}

export function filtrarBuzon(buzon, { tipo, tiposIn, obraId, estado, estadosIn } = {}) {
  const out = {};
  for (const [id, item] of Object.entries(buzon || {})) {
    if (tipo && item.tipo !== tipo) continue;
    if (tiposIn && !tiposIn.includes(item.tipo)) continue;
    if (obraId && item.obraId !== obraId) continue;
    if (estado && item.estado !== estado) continue;
    if (estadosIn && !estadosIn.includes(item.estado)) continue;
    out[id] = item;
  }
  return out;
}

// === Meta de la app (calendario semanal global) ===

const META_DEFAULT = {
  calendarioSemanal: { diaInicio: 'lun', diaCorte: 'vie', diasLaborables: 5 }
};

export async function getMeta() {
  const m = await rread('meta');
  return { ...META_DEFAULT, ...(m || {}) };
}
export async function updateMeta(patch) {
  return rupdate('meta', { ...patch, updatedAt: Date.now() });
}

// === Categorías de gasto indirecto (CRUD admin) ===

const CATEGORIAS_SEMILLA = [
  { id: 'oficina',      nombre: 'Oficina',       activa: true, orden: 1 },
  { id: 'gasolina',     nombre: 'Gasolina',      activa: true, orden: 2 },
  { id: 'servicios',    nombre: 'Servicios',     activa: true, orden: 3 },
  { id: 'telefonia',    nombre: 'Telefonía',     activa: true, orden: 4 },
  { id: 'viaticos',     nombre: 'Viáticos',      activa: true, orden: 5 },
  { id: 'mantenimiento',nombre: 'Mantenimiento', activa: true, orden: 6 },
  { id: 'otros',        nombre: 'Otros',         activa: true, orden: 7 }
];

export async function listCategoriasGasto() {
  const raw = await rread('categorias_gasto');
  if (!raw || Object.keys(raw).length === 0) return CATEGORIAS_SEMILLA;
  return Object.entries(raw).map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

export async function seedCategoriasGastoSiVacio() {
  const raw = await rread('categorias_gasto');
  if (raw && Object.keys(raw).length > 0) return false;
  const patch = {};
  for (const c of CATEGORIAS_SEMILLA) {
    patch[c.id] = { nombre: c.nombre, activa: c.activa, orden: c.orden, createdAt: Date.now() };
  }
  await rset('categorias_gasto', patch);
  return true;
}

export async function upsertCategoriaGasto(id, data) {
  return rset(`categorias_gasto/${id}`, data);
}
export async function removeCategoriaGasto(id) {
  return rremove(`categorias_gasto/${id}`);
}

// === Empleados (CRUD propio) ===

export async function listEmpleados() {
  return (await rread('empleados')) || {};
}
export async function getEmpleado(empleadoId) {
  return await rread(`empleados/${empleadoId}`);
}
export async function createEmpleado(data) {
  return rpush('empleados', { ...data, createdAt: Date.now(), updatedAt: Date.now() });
}
export async function updateEmpleado(empleadoId, patch) {
  return rupdate(`empleados/${empleadoId}`, { ...patch, updatedAt: Date.now() });
}
export async function removeEmpleado(empleadoId) {
  return rremove(`empleados/${empleadoId}`);
}

// === Períodos de nómina ===

export async function listPeriodos() {
  return (await rread('periodos')) || {};
}
export async function getPeriodo(periodoId) {
  return await rread(`periodos/${periodoId}`);
}
export async function setPeriodo(periodoId, data) {
  return rset(`periodos/${periodoId}`, data);
}
export async function updatePeriodo(periodoId, patch) {
  return rupdate(`periodos/${periodoId}`, { ...patch, updatedAt: Date.now() });
}

export async function setPeriodoEmpleado(periodoId, empleadoId, data) {
  return rset(`periodos/${periodoId}/empleados/${empleadoId}`, data);
}
export async function updatePeriodoEmpleado(periodoId, empleadoId, patch) {
  return rupdate(`periodos/${periodoId}/empleados/${empleadoId}`, patch);
}

// === Escenarios de proyección de nómina ===
//
// Cada escenario es una "plantilla hipotética" de empleados con sus sueldos
// y deducciones estimadas. No publica al buzón ni mueve dinero — es pura
// planeación para ver el costo futuro de la nómina al armar plantilla.
//
// Path: /shared/indirectos/escenarios/{escenarioId}
//   meta: { nombre, descripcion?, factorPatronal (default 1.35),
//           createdAt, updatedAt, createdBy }
//   empleados: { [rowId]: {
//     nombre, tipo, sueldoBase,
//     sourceEmpleadoId?,    # si vino del catálogo real
//     bonosEstimados?, deduccionesEstimadas?: {isr,imss,infonavit,prestamos},
//     notas?
//   }}

export async function listEscenarios() {
  return (await rread('escenarios')) || {};
}
export async function getEscenario(escenarioId) {
  return await rread(`escenarios/${escenarioId}`);
}
export async function createEscenario(data) {
  return rpush('escenarios', {
    meta: {
      nombre: data.nombre || 'Escenario sin nombre',
      descripcion: data.descripcion || null,
      factorPatronal: data.factorPatronal ?? 1.35,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: data.createdBy || null
    },
    empleados: data.empleados || {}
  });
}
export async function updateEscenarioMeta(escenarioId, patch) {
  return rupdate(`escenarios/${escenarioId}/meta`, { ...patch, updatedAt: Date.now() });
}
export async function removeEscenario(escenarioId) {
  return rremove(`escenarios/${escenarioId}`);
}
export async function setEscenarioEmpleado(escenarioId, rowId, data) {
  await rset(`escenarios/${escenarioId}/empleados/${rowId}`, data);
  await rupdate(`escenarios/${escenarioId}/meta`, { updatedAt: Date.now() });
}
export async function removeEscenarioEmpleado(escenarioId, rowId) {
  await rremove(`escenarios/${escenarioId}/empleados/${rowId}`);
  await rupdate(`escenarios/${escenarioId}/meta`, { updatedAt: Date.now() });
}

// === Gastos indirectos sueltos ===

export async function listGastos() {
  return (await rread('gastos')) || {};
}
export async function getGasto(gastoId) {
  return await rread(`gastos/${gastoId}`);
}
export async function createGasto(data) {
  return rpush('gastos', { ...data, createdAt: Date.now(), updatedAt: Date.now() });
}
export async function updateGasto(gastoId, patch) {
  return rupdate(`gastos/${gastoId}`, { ...patch, updatedAt: Date.now() });
}
export async function removeGasto(gastoId) {
  return rremove(`gastos/${gastoId}`);
}
