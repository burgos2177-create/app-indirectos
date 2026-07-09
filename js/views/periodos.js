import { h, toast, modal } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import {
  listPeriodos, getPeriodo, setPeriodo, updatePeriodo,
  listEmpleados, updateEmpleado, getMeta,
  pushBuzonItem, getBuzonItem, deleteBuzonItem
} from '../services/db.js';
import { navigate } from '../state/router.js';
import { money, num0, dateMx, tipoPersonalLabel, periodicidadDeTipo } from '../util/format.js';
import { periodoActual } from '../util/calendario.js';
import { calcularProyeccion } from './escenario.js';

const TIPOS = ['operativo', 'tecnico_campo', 'tecnico_oficina', 'directivo'];

// Factor patronal para estimar el costo total (sueldo + cuotas). Igual que la
// proyección; en v2 podría venir de configuración.
const FACTOR_PATRONAL = 1.35;
const SEMANAS_ANO = 52;
const QUINCENAS_ANO = 24;

// tipo de personal → tipo de item que bitácora consume del buzón.
const BUZON_TIPO = {
  operativo: 'nomina_operativo_semana',
  tecnico_campo: 'nomina_tecnico_campo_quincena',
  tecnico_oficina: 'nomina_tecnico_oficina_quincena',
  directivo: 'nomina_directivo_quincena'
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Cálculo del neto de un empleado-período.
// Percepciones = sueldo base prorrateado por días + horas extra ($) + bonos + prestaciones.
// Deducciones  = ISR + IMSS + INFONAVIT + préstamos/otros (manuales).
function calc(row, diasLaborables) {
  const base = Number(row.sueldoBase) || 0;
  const dias = Number(row.diasTrabajados);
  const diasEf = Number.isFinite(dias) ? dias : diasLaborables;
  const sueldoProp = diasLaborables > 0 ? base * (diasEf / diasLaborables) : base;
  const extra = Number(row.horasExtra) || 0;
  const bonos = Number(row.bonos) || 0;
  const prest = Number(row.prestaciones) || 0;
  const percepciones = sueldoProp + extra + bonos + prest;
  const d = row.deducciones || {};
  const dedTotal = (Number(d.isr) || 0) + (Number(d.imss) || 0) + (Number(d.infonavit) || 0) + (Number(d.prestamos) || 0);
  return { sueldoProp, percepciones, dedTotal, neto: percepciones - dedTotal };
}

function sumaNeto(doc) {
  const diasLab = Number(doc.diasLaborables) || 0;
  return Object.values(doc.empleados || {}).reduce((s, e) => s + calc(e, diasLab).neto, 0);
}

// La fecha de corte es la fecha límite para liquidar el período.
const DIA_MS = 86400000;
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

function vencInfo(vencMs, cerrado) {
  if (!vencMs) return { txt: '—', cls: 'muted' };
  if (cerrado) return { txt: 'Liquidado', cls: 'ok' };
  const dias = Math.round((startOfDay(vencMs) - startOfDay(Date.now())) / DIA_MS);
  if (dias < 0) return { txt: `Vencido hace ${-dias}d`, cls: 'danger' };
  if (dias === 0) return { txt: 'Vence hoy', cls: 'danger' };
  if (dias <= 2) return { txt: `Vence en ${dias}d`, cls: 'warn' };
  return { txt: `Vence en ${dias}d`, cls: '' };
}

const vencimientoDe = (doc) => Number(doc?.fechaVencimiento) || Number(doc?.fechaCorte) || 0;

const ESTADO_TAG = {
  cerrado: ['ok', 'Cerrado'],
  programado: ['accent', 'Programado'],
  borrador: ['warn', 'Borrador']
};
function estadoBadge(doc) {
  if (!doc) return h('span', { class: 'tag muted' }, 'Sin armar');
  const [cls, label] = ESTADO_TAG[doc.estado] || ESTADO_TAG.borrador;
  return h('span', { class: 'tag ' + cls }, label);
}

function kpi(label, value, cls = '') {
  return h('div', { class: 'kpi ' + cls }, [
    h('span', { class: 'kpi-label' }, label),
    h('span', { class: 'kpi-value' }, value)
  ]);
}

function mismoMes(ms, ref) {
  const d = new Date(ms);
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
}

// ===================== LISTA (carriles + histórico) =====================

export async function renderPeriodos() {
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Períodos' }];
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando períodos…'));

  let periodos, empleados, meta;
  try {
    [periodos, empleados, meta] = await Promise.all([listPeriodos(), listEmpleados(), getMeta()]);
  } catch (err) {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message));
    return;
  }
  const cal = meta.calendarioSemanal;
  const empArr = Object.entries(empleados || {}).map(([id, e]) => ({ id, ...e }));
  const activosAll = empArr.filter(e => e.activo !== false);

  const carriles = TIPOS.map(tipo => {
    const per = periodoActual(tipo, new Date(), cal);
    const doc = (periodos || {})[per.periodoId] || null;
    const activosArr = empArr.filter(e => e.tipo === tipo && e.activo !== false);
    const proyectado = activosArr.reduce((s, e) => s + (Number(e.sueldoBase) || 0), 0);
    return { tipo, per, doc, activos: activosArr.length, proyectado };
  });

  const cardsWrap = h('div', { class: 'carril-grid' }, carriles.map(c => carrilCard(c)));

  // Histórico: todos los períodos guardados, más reciente primero.
  const hist = Object.entries(periodos || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (b.fechaCorte || 0) - (a.fechaCorte || 0));

  renderShell(crumbs, h('div', {}, [
    h('h1', {}, 'Períodos de nómina'),
    h('p', { class: 'muted', style: { margin: '0 0 16px' } },
      'Cuatro carriles independientes. Arma el período, prográmalo con su fecha de liquidación, captura días/deducciones y ciérralo para enviarlo al buzón.'),
    resumenPlantilla(activosAll, periodos),
    h('h2', {}, 'Períodos actuales'),
    cardsWrap,
    h('h2', {}, 'Histórico'),
    hist.length === 0
      ? h('div', { class: 'empty' }, 'Aún no se ha armado ningún período.')
      : historicoTable(hist)
  ]));
}

// Resumen del costo mensual de la plantilla real + lo comprometido este mes.
function resumenPlantilla(activosAll, periodos) {
  const proy = calcularProyeccion(activosAll, FACTOR_PATRONAL);
  const now = new Date();
  const periodosArr = Object.entries(periodos || {}).map(([id, p]) => ({ id, ...p }));
  const delMes = periodosArr.filter(p => p.fechaCorte && mismoMes(p.fechaCorte, now));
  const netoMes = delMes.reduce((s, p) => s + (p.totalNeto != null ? p.totalNeto : sumaNeto(p)), 0);

  const breakdown = TIPOS.map(t => {
    const bruto = proy.porTipo[t] || 0;
    const n = proy.counts[t] || 0;
    const mensual = periodicidadDeTipo(t) === 'semanal' ? bruto * SEMANAS_ANO / 12 : bruto * QUINCENAS_ANO / 12;
    return h('div', { class: 'tipo-row' }, [
      h('div', {}, [
        h('span', { class: 'tag' }, tipoPersonalLabel[t]),
        h('span', { class: 'muted', style: { fontSize: '11px', marginLeft: '6px' } },
          `${num0(n)} pers · ${periodicidadDeTipo(t) === 'semanal' ? 'semanal' : 'quincenal'}`)
      ]),
      h('div', { class: 'tipo-val' }, [h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Por período: '), h('b', {}, money(bruto))]),
      h('div', { class: 'tipo-val' }, [h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Mensual: '), h('b', {}, money(mensual))])
    ]);
  });

  return h('div', { class: 'card' }, [
    h('h3', {}, 'Plantilla activa · costo mensual'),
    h('div', { class: 'kpi-row' }, [
      kpi('Plantilla', num0(activosAll.length) + ' pers.'),
      kpi('Nómina mensual (bruto)', money(proy.brutoMensual), 'highlight'),
      kpi('Costo total mensual', money(proy.costoTotalMensual), 'accent'),
      kpi('Nómina anual (bruto)', money(proy.brutoAnual)),
      kpi('Comprometido este mes', money(netoMes))
    ]),
    h('p', { class: 'muted', style: { fontSize: '11px', margin: '10px 0 0' } },
      `Costo total = bruto × ${FACTOR_PATRONAL} (cuotas patronales estimadas). "Comprometido este mes" suma el neto de los períodos con corte en el mes actual.`),
    h('div', { class: 'tipo-breakdown', style: { marginTop: '12px' } }, breakdown)
  ]);
}

function carrilCard(c) {
  const { tipo, per, doc, activos, proyectado } = c;
  const venc = doc ? vencimientoDe(doc) : per.fechaCorte;
  const vi = vencInfo(venc, doc?.estado === 'cerrado');
  const totalNeto = doc ? sumaNeto(doc) : null;

  const accion = doc
    ? h('button', { class: 'btn primary sm', onClick: () => navigate('/periodos/' + per.periodoId) },
        doc.estado === 'cerrado' ? 'Ver período' : 'Continuar captura')
    : activos === 0
      ? h('button', { class: 'btn sm', disabled: true }, 'Sin personal activo')
      : h('button', { class: 'btn primary sm', onClick: () => armarPeriodo(tipo) }, '+ Armar período actual');

  const desincronizado = doc && doc.proyectadoBruto != null && Math.abs(Number(doc.proyectadoBruto) - proyectado) > 0.01;

  return h('div', { class: 'carril-card' }, [
    h('div', { class: 'carril-head' }, [
      h('h3', {}, tipoPersonalLabel[tipo]),
      h('div', { class: 'row', style: { gap: '6px' } }, [
        estadoBadge(doc),
        h('span', { class: 'tag ' + vi.cls }, vi.txt)
      ])
    ]),
    h('div', { class: 'muted', style: { fontSize: '12px' } }, per.label),
    h('div', { class: 'carril-meta' }, [
      cm('Personal activo', num0(activos) + ' pers.'),
      cm('Vence', dateMx(venc)),
      cm('Proyectado', money(proyectado)),
      doc ? cm('Neto capturado', money(totalNeto)) : null
    ]),
    desincronizado
      ? h('div', { class: 'muted', style: { fontSize: '11px', color: 'var(--warn)' } },
          `El catálogo cambió (proyectado ${money(proyectado)} vs armado ${money(doc.proyectadoBruto)}). Actualiza para reflejar los nuevos salarios.`)
      : null,
    h('div', { class: 'row' }, [
      accion,
      doc && doc.estado !== 'cerrado'
        ? h('button', { class: 'btn ghost sm', title: 'Actualizar sueldos desde el catálogo', onClick: () => regenerarQuick(per.periodoId) }, '↻ Salarios')
        : null
    ])
  ]);
}

function cm(label, value) {
  return h('div', { class: 'cm' }, [
    h('span', { class: 'cm-label' }, label),
    h('span', { class: 'cm-value' }, value)
  ]);
}

function historicoTable(rows) {
  return h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
    h('table', { class: 'tbl' }, [
      h('thead', {}, [h('tr', {}, [
        h('th', {}, 'Tipo'),
        h('th', {}, 'Período'),
        h('th', {}, 'Estado'),
        h('th', {}, 'Vence'),
        h('th', { class: 'num' }, 'Proyectado'),
        h('th', { class: 'num' }, 'Neto'),
        h('th', {}, 'Actualizado')
      ])]),
      h('tbody', {}, rows.map(p => {
        const venc = vencimientoDe(p);
        const vi = vencInfo(venc, p.estado === 'cerrado');
        return h('tr', {
          style: { cursor: 'pointer' },
          onClick: () => navigate('/periodos/' + p.id)
        }, [
          h('td', {}, h('span', { class: 'tag' }, tipoPersonalLabel[p.tipo] || p.tipo)),
          h('td', {}, p.label || p.id),
          h('td', {}, estadoBadge(p)),
          h('td', {}, [
            h('span', { class: 'muted', style: { fontSize: '12px' } }, dateMx(venc)),
            h('span', { class: 'tag ' + vi.cls, style: { marginLeft: '6px', fontSize: '10px' } }, vi.txt)
          ]),
          h('td', { class: 'num muted' }, p.proyectadoBruto != null ? money(p.proyectadoBruto) : '—'),
          h('td', { class: 'num' }, money(p.totalNeto != null ? p.totalNeto : sumaNeto(p))),
          h('td', { class: 'muted' }, dateMx(p.updatedAt || p.createdAt))
        ]);
      }))
    ])
  ]);
}

async function armarPeriodo(tipo) {
  try {
    const meta = await getMeta();
    const per = periodoActual(tipo, new Date(), meta.calendarioSemanal);
    const existing = await getPeriodo(per.periodoId);
    if (existing) { navigate('/periodos/' + per.periodoId); return; }

    const empleados = await listEmpleados();
    const activos = Object.entries(empleados || {}).filter(([, e]) => e.tipo === tipo && e.activo !== false);
    if (activos.length === 0) {
      toast('No hay empleados activos de tipo ' + tipoPersonalLabel[tipo], 'warn');
      return;
    }
    const empMap = {};
    let proyectadoBruto = 0;
    for (const [id, e] of activos) {
      const ud = e.ultimasDeducciones || {};
      const base = Number(e.sueldoBase) || 0;
      proyectadoBruto += base;
      empMap[id] = {
        nombre: e.nombre || '(sin nombre)',
        tipo: e.tipo,
        sueldoBase: base,
        diasTrabajados: per.diasLaborables,
        horasExtra: 0,
        bonos: 0,
        prestaciones: 0,
        deducciones: {
          isr: Number(ud.isr) || 0, imss: Number(ud.imss) || 0,
          infonavit: Number(ud.infonavit) || 0, prestamos: Number(ud.prestamos) || 0
        },
        obrasAsignadas: e.obrasAsignadas || {}
      };
    }
    await setPeriodo(per.periodoId, {
      tipo: per.tipo, periodicidad: per.periodicidad,
      fechaInicio: per.fechaInicio, fechaCorte: per.fechaCorte,
      fechaInicioISO: per.fechaInicioISO, fechaCorteISO: per.fechaCorteISO,
      fechaVencimiento: per.fechaCorte,   // se debe liquidar a más tardar en el corte
      label: per.label, diasLaborables: per.diasLaborables,
      proyectadoBruto: round2(proyectadoBruto),
      estado: 'borrador', empleados: empMap,
      createdAt: Date.now(), updatedAt: Date.now(), createdBy: state.user?.uid || null
    });
    toast(`Período armado con ${activos.length} empleado(s)`, 'ok');
    navigate('/periodos/' + per.periodoId);
  } catch (err) {
    toast('Error: ' + err.message, 'danger');
  }
}

// Re-sincroniza un período (borrador/programado) con el catálogo actual:
// actualiza sueldos base y ajusta la lista al personal activo, CONSERVANDO
// los días/horas/bonos/deducciones ya capturados por empleado.
async function regenerarPeriodo(periodoId) {
  const doc = await getPeriodo(periodoId);
  if (!doc || doc.estado === 'cerrado') return false;
  const empleados = await listEmpleados();
  const activos = Object.entries(empleados || {}).filter(([, e]) => e.tipo === doc.tipo && e.activo !== false);
  const prev = doc.empleados || {};
  const empMap = {};
  let proyectadoBruto = 0;
  for (const [id, e] of activos) {
    const base = Number(e.sueldoBase) || 0;
    proyectadoBruto += base;
    const p = prev[id];
    if (p) {
      // Conserva la captura; actualiza los datos que vienen del catálogo.
      empMap[id] = { ...p, nombre: e.nombre || p.nombre, sueldoBase: base, obrasAsignadas: e.obrasAsignadas || {} };
    } else {
      const ud = e.ultimasDeducciones || {};
      empMap[id] = {
        nombre: e.nombre || '(sin nombre)', tipo: e.tipo, sueldoBase: base,
        diasTrabajados: doc.diasLaborables, horasExtra: 0, bonos: 0, prestaciones: 0,
        deducciones: {
          isr: Number(ud.isr) || 0, imss: Number(ud.imss) || 0,
          infonavit: Number(ud.infonavit) || 0, prestamos: Number(ud.prestamos) || 0
        },
        obrasAsignadas: e.obrasAsignadas || {}
      };
    }
  }
  await updatePeriodo(periodoId, { empleados: empMap, proyectadoBruto: round2(proyectadoBruto) });
  return true;
}

async function confirmarRegenerar() {
  return modal({
    title: 'Actualizar desde catálogo',
    body: h('div', {}, [
      h('p', {}, 'Se actualizan los sueldos base al valor actual del catálogo de empleados y se ajusta la lista al personal activo.'),
      h('p', { class: 'muted', style: { fontSize: '12px' } },
        'Se conservan los días, horas extra, bonos y deducciones que ya hayas capturado. No aplica a períodos cerrados.')
    ]),
    confirmLabel: 'Actualizar'
  });
}

async function regenerarQuick(periodoId) {
  if (!await confirmarRegenerar()) return;
  try {
    await regenerarPeriodo(periodoId);
    toast('Período actualizado con los nuevos salarios', 'ok');
    renderPeriodos();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}

// ===================== DETALLE (captura / cierre) =====================

export async function renderPeriodoDetalle({ params }) {
  const periodoId = params.id;
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Períodos', to: '/periodos' }, { label: 'Detalle' }];
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando…'));

  let doc;
  try { doc = await getPeriodo(periodoId); }
  catch (err) { renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message)); return; }
  if (!doc) {
    renderShell(crumbs, h('div', { class: 'empty' }, [
      h('div', {}, 'Este período no ha sido armado todavía.'),
      h('div', { style: { marginTop: '10px' } }, h('a', { href: '#/periodos' }, '← Volver a Períodos'))
    ]));
    return;
  }

  const cerrado = doc.estado === 'cerrado';
  const diasLab = Number(doc.diasLaborables) || 0;

  const rows = Object.entries(doc.empleados || {}).map(([empleadoId, e]) => ({
    empleadoId,
    nombre: e.nombre || '(sin nombre)',
    tipo: e.tipo,
    sueldoBase: Number(e.sueldoBase) || 0,
    diasTrabajados: e.diasTrabajados != null ? Number(e.diasTrabajados) : diasLab,
    horasExtra: Number(e.horasExtra) || 0,
    bonos: Number(e.bonos) || 0,
    prestaciones: Number(e.prestaciones) || 0,
    deducciones: {
      isr: Number(e.deducciones?.isr) || 0, imss: Number(e.deducciones?.imss) || 0,
      infonavit: Number(e.deducciones?.infonavit) || 0, prestamos: Number(e.deducciones?.prestamos) || 0
    },
    obrasAsignadas: e.obrasAsignadas || {}
  }));

  // KPIs (se recalculan en vivo).
  const kPercep = h('span', { class: 'kpi-value' }, '');
  const kDed = h('span', { class: 'kpi-value' }, '');
  const kNeto = h('span', { class: 'kpi-value' }, '');
  const proyectadoBase = doc.proyectadoBruto != null
    ? Number(doc.proyectadoBruto)
    : rows.reduce((s, r) => s + (Number(r.sueldoBase) || 0), 0);
  const kpiRow = h('div', { class: 'kpi-row' }, [
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Personal'), h('span', { class: 'kpi-value' }, num0(rows.length) + ' pers.')]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Proyectado (base)'), h('span', { class: 'kpi-value' }, money(proyectadoBase))]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Percepciones'), kPercep]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Deducciones'), kDed]),
    h('div', { class: 'kpi accent' }, [h('span', { class: 'kpi-label' }, 'Neto a pagar'), kNeto])
  ]);

  function recompute() {
    let tP = 0, tD = 0, tN = 0;
    for (const r of rows) {
      const c = calc(r, diasLab);
      if (r._percep) r._percep.textContent = money(c.percepciones);
      if (r._neto) r._neto.textContent = money(c.neto);
      tP += c.percepciones; tD += c.dedTotal; tN += c.neto;
    }
    kPercep.textContent = money(tP);
    kDed.textContent = money(tD);
    kNeto.textContent = money(tN);
  }

  function cellInput(getVal, setVal, extraCls = '') {
    const el = h('input', {
      type: 'number', step: '0.01', min: '0',
      value: getVal(), class: ('cell ' + extraCls).trim(), disabled: cerrado,
      onInput: () => { setVal(el.value); recompute(); }
    });
    return el;
  }

  function rowEl(r) {
    r._percep = h('td', { class: 'num' }, '');
    r._neto = h('td', { class: 'neto' }, '');
    const diasEl = cellInput(() => r.diasTrabajados, v => { r.diasTrabajados = v === '' ? '' : Number(v); }, 'dias');
    const heEl = cellInput(() => r.horasExtra, v => { r.horasExtra = Number(v) || 0; });
    const bonEl = cellInput(() => r.bonos, v => { r.bonos = Number(v) || 0; });
    const preEl = cellInput(() => r.prestaciones, v => { r.prestaciones = Number(v) || 0; });
    const isrEl = cellInput(() => r.deducciones.isr, v => { r.deducciones.isr = Number(v) || 0; });
    const imssEl = cellInput(() => r.deducciones.imss, v => { r.deducciones.imss = Number(v) || 0; });
    const infoEl = cellInput(() => r.deducciones.infonavit, v => { r.deducciones.infonavit = Number(v) || 0; });
    const prestEl = cellInput(() => r.deducciones.prestamos, v => { r.deducciones.prestamos = Number(v) || 0; });
    return h('tr', {}, [
      h('td', {}, h('b', {}, r.nombre)),
      h('td', { class: 'num muted' }, money(r.sueldoBase)),
      h('td', { class: 'cell-td' }, diasEl),
      h('td', { class: 'cell-td' }, heEl),
      h('td', { class: 'cell-td' }, bonEl),
      h('td', { class: 'cell-td' }, preEl),
      r._percep,
      h('td', { class: 'cell-td sep-l' }, isrEl),
      h('td', { class: 'cell-td' }, imssEl),
      h('td', { class: 'cell-td' }, infoEl),
      h('td', { class: 'cell-td' }, prestEl),
      r._neto
    ]);
  }

  const tableCard = h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
    h('table', { class: 'tbl' }, [
      h('thead', {}, [h('tr', {}, [
        h('th', {}, 'Empleado'),
        h('th', { class: 'num' }, 'Base'),
        h('th', { class: 'num' }, `Días /${diasLab}`),
        h('th', { class: 'num' }, 'H. extra $'),
        h('th', { class: 'num' }, 'Bonos'),
        h('th', { class: 'num' }, 'Prestac.'),
        h('th', { class: 'num' }, 'Percep.'),
        h('th', { class: 'num sep-l' }, 'ISR'),
        h('th', { class: 'num' }, 'IMSS'),
        h('th', { class: 'num' }, 'INFONAVIT'),
        h('th', { class: 'num' }, 'Préstamos'),
        h('th', { class: 'num' }, 'Neto')
      ])]),
      h('tbody', {}, rows.map(rowEl))
    ])
  ]);

  // === Guardar borrador ===
  function buildEmpMap() {
    const m = {};
    for (const r of rows) {
      m[r.empleadoId] = {
        nombre: r.nombre, tipo: r.tipo, sueldoBase: r.sueldoBase,
        diasTrabajados: Number(r.diasTrabajados) || 0,
        horasExtra: Number(r.horasExtra) || 0,
        bonos: Number(r.bonos) || 0,
        prestaciones: Number(r.prestaciones) || 0,
        deducciones: { ...r.deducciones },
        obrasAsignadas: r.obrasAsignadas || {}
      };
    }
    return m;
  }

  const guardarBtn = h('button', { class: 'btn', onClick: guardarBorrador }, 'Guardar borrador');
  async function guardarBorrador() {
    guardarBtn.disabled = true;
    try {
      await updatePeriodo(periodoId, { empleados: buildEmpMap() });
      toast('Borrador guardado', 'ok');
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
    guardarBtn.disabled = false;
  }

  // === Cerrar y enviar al buzón ===
  const cerrarBtn = h('button', { class: 'btn primary', onClick: cerrarYEnviar }, 'Cerrar y enviar al buzón');
  async function cerrarYEnviar() {
    if (rows.length === 0) { toast('No hay empleados en este período', 'warn'); return; }
    const ok = await modal({
      title: 'Cerrar y enviar al buzón',
      body: h('div', {}, [
        h('p', {}, `Se enviará la nómina de ${tipoPersonalLabel[doc.tipo]} (${doc.label}) al buzón para que el contador la apruebe en bitácora.`),
        h('p', { class: 'muted', style: { fontSize: '12px' } },
          'Al cerrar, el período queda de solo lectura y las deducciones capturadas se guardan como prefill del próximo período. Podrás reabrirlo mientras bitácora no lo haya procesado.')
      ]),
      confirmLabel: 'Cerrar y enviar'
    });
    if (!ok) return;

    let totalPercep = 0, totalDed = 0, totalNeto = 0, netoSinObra = 0;
    const prorrateoPorObra = {};
    const empSnapshot = {};
    for (const r of rows) {
      const c = calc(r, diasLab);
      totalPercep += c.percepciones; totalDed += c.dedTotal; totalNeto += c.neto;
      empSnapshot[r.empleadoId] = {
        nombre: r.nombre, tipo: r.tipo, sueldoBase: r.sueldoBase,
        diasTrabajados: Number(r.diasTrabajados) || 0,
        horasExtra: Number(r.horasExtra) || 0,
        bonos: Number(r.bonos) || 0,
        prestaciones: Number(r.prestaciones) || 0,
        deducciones: { ...r.deducciones },
        obrasAsignadas: r.obrasAsignadas || {},
        percepciones: round2(c.percepciones),
        deduccionesTotal: round2(c.dedTotal),
        neto: round2(c.neto)
      };
      const oa = r.obrasAsignadas || {};
      const ids = Object.keys(oa);
      if (ids.length === 0) { netoSinObra += c.neto; continue; }
      const sp = ids.reduce((s, id) => s + (Number(oa[id]?.peso) || 0), 0);
      for (const id of ids) {
        const peso = Number(oa[id]?.peso) || 0;
        const frac = sp > 0 ? peso / sp : 1 / ids.length;
        prorrateoPorObra[id] = (prorrateoPorObra[id] || 0) + c.neto * frac;
      }
    }
    for (const id of Object.keys(prorrateoPorObra)) prorrateoPorObra[id] = round2(prorrateoPorObra[id]);

    // Envelope compatible con el buzón de contabilidad + campos propios de nómina.
    // La nómina es neto (sin IVA): subtotal = importe = totalNeto.
    const item = {
      tipo: BUZON_TIPO[doc.tipo] || 'nomina_individual',
      origenApp: 'indirectos',
      estado: 'recibido',
      creadoPor: state.user?.uid || null,
      concepto: `Nómina ${tipoPersonalLabel[doc.tipo]} · ${doc.label}`,
      fecha: doc.fechaCorteISO,
      monto: { subtotal: round2(totalNeto), iva: 0, importe: round2(totalNeto) },
      // --- extendido para nómina (bitácora: 1 movimiento Mifel + N por obra) ---
      periodoId, tipoPersonal: doc.tipo, periodicidad: doc.periodicidad,
      fechaInicioISO: doc.fechaInicioISO, fechaCorteISO: doc.fechaCorteISO, label: doc.label,
      totalPercepciones: round2(totalPercep), totalDeducciones: round2(totalDed), totalNeto: round2(totalNeto),
      numEmpleados: rows.length,
      prorrateoPorObra, netoSinObra: round2(netoSinObra),
      empleados: Object.entries(empSnapshot).map(([empleadoId, e]) => ({
        empleadoId, nombre: e.nombre, neto: e.neto, obrasAsignadas: e.obrasAsignadas
      }))
    };

    cerrarBtn.disabled = true; cerrarBtn.innerHTML = '<span class="spinner"></span> Enviando…';
    try {
      const buzonItemId = await pushBuzonItem(item);
      await updatePeriodo(periodoId, {
        empleados: empSnapshot, estado: 'cerrado', buzonItemId,
        totalNeto: round2(totalNeto), totalPercepciones: round2(totalPercep), totalDeducciones: round2(totalDed),
        cerradoAt: Date.now()
      });
      // Prefill de deducciones para el próximo período (best-effort).
      await Promise.allSettled(rows.map(r => updateEmpleado(r.empleadoId, { ultimasDeducciones: { ...r.deducciones } })));
      toast('Nómina enviada al buzón', 'ok');
      navigate('/periodos');
    } catch (err) {
      toast('Error: ' + err.message, 'danger');
      cerrarBtn.disabled = false; cerrarBtn.textContent = 'Cerrar y enviar al buzón';
    }
  }

  // === Reabrir (período cerrado) ===
  async function reabrir() {
    let item = null;
    if (doc.buzonItemId) { try { item = await getBuzonItem(doc.buzonItemId); } catch { item = null; } }
    if (item && item.estado && item.estado !== 'recibido') {
      toast('Contabilidad ya procesó esta nómina; no se puede reabrir.', 'warn');
      return;
    }
    const ok = await modal({
      title: 'Reabrir período',
      body: 'Se quitará el item del buzón y el período volverá a borrador para editarlo. ¿Continuar?',
      confirmLabel: 'Reabrir'
    });
    if (!ok) return;
    try {
      if (doc.buzonItemId) await deleteBuzonItem(doc.buzonItemId);
      await updatePeriodo(periodoId, { estado: 'borrador', buzonItemId: null, cerradoAt: null });
      toast('Período reabierto', 'ok');
      renderPeriodoDetalle({ params });
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  }

  async function programar() {
    try {
      const venc = vencimientoDe(doc);
      await updatePeriodo(periodoId, { estado: 'programado', fechaVencimiento: venc });
      toast('Período programado · vence ' + dateMx(venc), 'ok');
      renderPeriodoDetalle({ params });
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  }
  async function volverABorrador() {
    try {
      await updatePeriodo(periodoId, { estado: 'borrador' });
      toast('Movido a borrador', 'ok');
      renderPeriodoDetalle({ params });
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  }
  async function actualizarSalarios() {
    if (!await confirmarRegenerar()) return;
    try {
      await regenerarPeriodo(periodoId);
      toast('Salarios actualizados desde el catálogo', 'ok');
      renderPeriodoDetalle({ params });
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  }

  const programado = doc.estado === 'programado';
  const actions = cerrado
    ? h('div', { class: 'row', style: { marginTop: '14px', justifyContent: 'flex-end' } }, [
        h('button', { class: 'btn ghost', onClick: () => navigate('/periodos') }, 'Volver'),
        h('button', { class: 'btn', onClick: reabrir }, 'Reabrir para editar')
      ])
    : h('div', { class: 'row', style: { marginTop: '14px', justifyContent: 'flex-end' } }, [
        h('button', { class: 'btn ghost', onClick: () => navigate('/periodos') }, 'Volver'),
        programado
          ? h('button', { class: 'btn ghost', onClick: volverABorrador }, 'Volver a borrador')
          : h('button', { class: 'btn', onClick: programar }, 'Programar liquidación'),
        guardarBtn,
        cerrarBtn
      ]);

  const venc = vencimientoDe(doc);
  const vi = vencInfo(venc, cerrado);

  recompute();

  renderShell(crumbs, h('div', {}, [
    h('h1', {}, `${tipoPersonalLabel[doc.tipo]} · nómina`),
    h('div', { class: 'row', style: { margin: '0 0 14px', gap: '8px' } }, [
      estadoBadge(doc),
      h('span', { class: 'tag ' + vi.cls }, `${vi.txt} · ${dateMx(venc)}`),
      h('span', { class: 'muted', style: { fontSize: '12px' } },
        `${doc.label} · ${periodicidadDeTipo(doc.tipo) === 'semanal' ? 'Semanal' : 'Quincenal'} · ${diasLab} días`)
    ]),
    cerrado
      ? h('div', { class: 'readonly-banner' }, [
          h('span', { class: 'tag ok' }, 'Cerrado'),
          h('span', {}, `Enviado al buzón (${doc.buzonItemId || '—'}). Neto total ${money(doc.totalNeto != null ? doc.totalNeto : sumaNeto(doc))}. Solo lectura.`)
        ])
      : null,
    h('div', { class: 'card' }, [
      h('div', { class: 'row' }, [
        h('h3', { style: { margin: 0 } }, 'Resumen'),
        h('div', { style: { flex: 1 } }),
        cerrado ? null : h('button', { class: 'btn ghost sm', onClick: actualizarSalarios }, '↻ Actualizar salarios')
      ]),
      h('div', { style: { marginTop: '12px' } }, kpiRow)
    ]),
    h('div', { style: { marginTop: '14px' } }, tableCard),
    actions
  ]));
}
