import { h, toast } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state, setState } from '../state/store.js';
import { listEmpleados, listObrasLegacy } from '../services/db.js';
import { navigate } from '../state/router.js';
import { money, tipoPersonalLabel, periodicidadDeTipo } from '../util/format.js';

const TIPOS = ['operativo', 'tecnico_campo', 'tecnico_oficina', 'directivo'];

export async function renderEmpleados({ query } = {}) {
  renderShell([{ label: 'Inicio', to: '/' }, { label: 'Empleados' }],
    h('div', { class: 'empty' }, 'Cargando empleados…'));

  let empleados, obras;
  try {
    [empleados, obras] = await Promise.all([listEmpleados(), listObrasLegacy()]);
  } catch (err) {
    renderShell([{ label: 'Inicio', to: '/' }, { label: 'Empleados' }],
      h('div', { class: 'empty' }, 'Error: ' + err.message));
    return;
  }
  setState({ obras });

  // Estado de filtros viene del query string para sobrevivir refresh.
  const filtroTipo = query?.tipo || '';
  const buscar = (query?.q || '').toLowerCase();
  const mostrarBajas = query?.bajas === '1';

  const lista = Object.entries(empleados || {}).map(([id, e]) => ({ id, ...e }));

  const filtrados = lista.filter(e => {
    if (filtroTipo && e.tipo !== filtroTipo) return false;
    if (!mostrarBajas && e.activo === false) return false;
    if (buscar && !(e.nombre || '').toLowerCase().includes(buscar)) return false;
    return true;
  });

  const stats = TIPOS.reduce((acc, t) => {
    acc[t] = lista.filter(e => e.tipo === t && e.activo !== false).length;
    return acc;
  }, {});

  const head = h('div', { class: 'row', style: { marginBottom: '14px' } }, [
    h('h1', { style: { margin: 0 } }, 'Empleados'),
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'btn primary', onClick: () => navigate('/empleados/nuevo') }, '+ Nuevo empleado')
  ]);

  // Chips de stats por tipo (clickables como filtros).
  const chips = h('div', { class: 'chips-row' }, [
    chip('Todos', !filtroTipo, lista.filter(e => e.activo !== false).length, () => updateQuery({ tipo: null })),
    ...TIPOS.map(t => chip(tipoPersonalLabel[t], filtroTipo === t, stats[t] || 0, () => updateQuery({ tipo: t })))
  ]);

  const buscador = h('div', { class: 'row', style: { marginBottom: '12px' } }, [
    h('input', {
      type: 'search',
      placeholder: 'Buscar por nombre…',
      value: query?.q || '',
      style: { flex: 1, maxWidth: '340px' },
      onInput: (e) => debounce('q', () => updateQuery({ q: e.target.value || null }))
    }),
    h('label', { class: 'row', style: { gap: '6px', cursor: 'pointer' } }, [
      h('input', { type: 'checkbox', checked: mostrarBajas, onChange: (e) => updateQuery({ bajas: e.target.checked ? '1' : null }) }),
      h('span', { class: 'muted' }, 'Incluir bajas')
    ])
  ]);

  const body = filtrados.length === 0
    ? h('div', { class: 'empty' }, [
        h('div', { class: 'ico' }, '👷'),
        h('div', {}, lista.length === 0
          ? 'No hay empleados aún. Crea el primero.'
          : 'No hay empleados que coincidan con los filtros.')
      ])
    : empleadosTable(filtrados, obras);

  renderShell([{ label: 'Inicio', to: '/' }, { label: 'Empleados' }],
    h('div', {}, [head, chips, buscador, body]));
}

function chip(label, active, count, onClick) {
  return h('button', {
    class: 'chip' + (active ? ' active' : ''),
    onClick
  }, [
    h('span', {}, label),
    h('span', { class: 'chip-count' }, String(count))
  ]);
}

function empleadosTable(rows, obras) {
  return h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
    h('table', { class: 'tbl' }, [
      h('thead', {}, [h('tr', {}, [
        h('th', {}, 'Nombre'),
        h('th', {}, 'Tipo'),
        h('th', {}, 'Periodicidad'),
        h('th', { class: 'num' }, 'Sueldo base'),
        h('th', {}, 'Obras (peso)'),
        h('th', {}, 'Estado')
      ])]),
      h('tbody', {}, rows.map(e => empleadoRow(e, obras)))
    ])
  ]);
}

function empleadoRow(e, obras) {
  const obrasAsig = e.obrasAsignadas || {};
  const obrasTxt = Object.entries(obrasAsig).map(([oid, info]) => {
    const nombre = obras[oid]?.meta?.nombre || oid.slice(0, 6);
    const peso = Number(info?.peso) || 0;
    return `${nombre} (${peso}%)`;
  }).join(', ') || h('span', { class: 'muted' }, '— sin asignar');
  const sumaPesos = Object.values(obrasAsig).reduce((s, o) => s + (Number(o?.peso) || 0), 0);
  const pesoOk = Math.abs(sumaPesos - 100) < 0.01 || sumaPesos === 0;
  return h('tr', {
    style: { cursor: 'pointer' },
    onClick: () => navigate('/empleados/' + e.id)
  }, [
    h('td', {}, h('b', {}, e.nombre || '(sin nombre)')),
    h('td', {}, h('span', { class: 'tag' }, tipoPersonalLabel[e.tipo] || e.tipo)),
    h('td', { class: 'muted' }, periodicidadDeTipo(e.tipo) === 'semanal' ? 'Semanal' : 'Quincenal'),
    h('td', { class: 'num' }, money(e.sueldoBase || 0)),
    h('td', {}, [
      typeof obrasTxt === 'string' ? obrasTxt : obrasTxt,
      !pesoOk && Object.keys(obrasAsig).length > 0
        ? h('span', { class: 'tag warn', style: { marginLeft: '6px' } }, `Σ ${sumaPesos}%`)
        : null
    ]),
    h('td', {}, e.activo === false
      ? h('span', { class: 'tag muted' }, 'Baja')
      : h('span', { class: 'tag ok' }, 'Activo'))
  ]);
}

// === query string helpers ===

function updateQuery(patch) {
  const cur = parseHashQuery();
  const next = { ...cur, ...patch };
  for (const k of Object.keys(next)) if (next[k] == null || next[k] === '') delete next[k];
  const qs = new URLSearchParams(next).toString();
  const base = '/empleados';
  navigate(qs ? `${base}?${qs}` : base);
}

function parseHashQuery() {
  const raw = (location.hash || '#/').slice(1);
  const i = raw.indexOf('?');
  if (i < 0) return {};
  return Object.fromEntries(new URLSearchParams(raw.slice(i + 1)).entries());
}

const _timers = {};
function debounce(key, fn, ms = 250) {
  clearTimeout(_timers[key]);
  _timers[key] = setTimeout(fn, ms);
}
