import { h, toast, modal } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import {
  listObrasLegacy, getCajaChica, getProyectoIdByObraId,
  reportarGastoCajaChica, depositarCajaChica, borrarMovimientoCajaChica
} from '../services/db.js';
import { navigate } from '../state/router.js';
import { money, dateMx, fromInputDate } from '../util/format.js';

const CATEGORIAS = ['Indirecto', 'Material', 'Mano de Obra', 'Subcontratista'];

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function autorActual() {
  const u = state.user || {};
  return { uid: u.uid || null, email: u.email || null, displayName: u.displayName || u.email || null };
}

// Fórmula de saldo EXACTA (misma en materiales y bitácora — no cambiar).
// Un saldo POR FONDO: cada movimiento pertenece al fondo 'transferencia'
// (m.fondo ausente, todo lo histórico) o 'efectivo' (billete físico; el
// contador lo saca de la caja física SOGRUB al aprobar el depósito).
// Depósitos cuentan cuando estado='aprobado' (sin estado = aprobado, legacy);
// en el fondo transferencia además deben ser metodo 'transferencia' (el
// depósito "efectivo" sin fondo es informativo). Gastos aprobados restan.
// Ver appsogrub/docs/spec-caja-chica-fondo-efectivo.md.
const fondoDeMov = (m) => (m?.fondo === 'efectivo' ? 'efectivo' : 'transferencia');

function calcSaldo(movs, fondo = 'transferencia') {
  let saldo = 0, depositado = 0, gastadoAprobado = 0, reportadoPend = 0, depositoPend = 0;
  for (const m of Object.values(movs || {})) {
    if (fondoDeMov(m) !== fondo) continue;
    const monto = Number(m.monto) || 0;
    if (m.tipo === 'deposito') {
      const metodo = m.metodoDeposito || 'transferencia';
      if (fondo === 'transferencia' && metodo === 'efectivo') continue; // informativo legacy
      const estado = m.estado || 'aprobado';   // legacy default
      if (estado === 'aprobado') { saldo += monto; depositado += monto; }
      else if (estado === 'solicitado') { depositoPend += monto; }
      // rechazado: no afecta
    } else if (m.tipo === 'gasto') {
      if (m.estado === 'aprobado') { saldo -= monto; gastadoAprobado += monto; }
      else if (m.estado === 'reportado') { reportadoPend += monto; }
      // rechazado: no afecta
    }
  }
  return { saldo, depositado, gastadoAprobado, reportadoPend, depositoPend };
}

function field(label, el, hint) {
  return h('div', { class: 'field' }, [h('label', {}, label), el, hint ? h('span', { class: 'muted', style: { fontSize: '11px' } }, hint) : null]);
}

export async function renderCajaChica({ query } = {}) {
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Caja chica' }];
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando…'));

  let obras;
  try { obras = await listObrasLegacy(); }
  catch (err) { renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message)); return; }

  const obraIds = Object.keys(obras || {});
  if (obraIds.length === 0) {
    renderShell(crumbs, h('div', {}, [
      h('h1', {}, 'Caja chica'),
      h('div', { class: 'empty' }, 'No hay obras. Las obras se crean en la app de estimaciones.')
    ]));
    return;
  }

  const obraId = (query?.obra && obras[query.obra]) ? query.obra : obraIds[0];
  const fondo = query?.fondo === 'efectivo' ? 'efectivo' : 'transferencia';
  const esEfectivo = fondo === 'efectivo';

  let caja;
  try { caja = await getCajaChica(obraId); }
  catch (err) { renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message)); return; }

  const movs = caja?.movimientos || {};
  const meta = caja?.meta || {};
  const umbral = Number(meta.umbralAlerta) || 1000;
  const s = calcSaldo(movs, fondo);
  const sOtro = calcSaldo(movs, esEfectivo ? 'transferencia' : 'efectivo');

  const refresh = () => renderCajaChica({ query: { obra: obraId, fondo } });

  // === Selector de obra ===
  const obraSel = h('select', {
    value: obraId,
    onChange: () => navigate('/caja-chica?obra=' + obraSel.value + '&fondo=' + fondo)
  }, obraIds.map(oid => h('option', { value: oid, selected: oid === obraId }, obras[oid]?.meta?.nombre || oid.slice(0, 6))));

  // === Selector de fondo (dos fondos conviven por obra) ===
  const fondoPill = (f, label, saldoStr) => h('button', {
    class: 'btn' + (f === fondo ? ' primary' : ''),
    style: f === fondo ? {} : { opacity: '.75' },
    onClick: () => navigate('/caja-chica?obra=' + obraId + '&fondo=' + f)
  }, label + (saldoStr ? ` · ${saldoStr}` : ''));
  const fondoRow = h('div', { class: 'row', style: { gap: '8px', marginBottom: '12px' } }, [
    fondoPill('transferencia', '🏦 Fondo transferencia', esEfectivo ? money(sOtro.saldo) : ''),
    fondoPill('efectivo', '💵 Fondo efectivo', esEfectivo ? '' : money(sOtro.saldo))
  ]);

  // === Saldo ===
  const saldoBajo = s.saldo < umbral;
  const kpiRow = h('div', { class: 'kpi-row' }, [
    h('div', { class: 'kpi ' + (saldoBajo ? '' : 'accent') }, [h('span', { class: 'kpi-label' }, 'Saldo conciliado'), h('span', { class: 'kpi-value', style: saldoBajo ? { color: 'var(--danger)' } : {} }, money(s.saldo))]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, esEfectivo ? 'Depositado (efectivo)' : 'Depositado (transfer.)'), h('span', { class: 'kpi-value' }, money(s.depositado))]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Gastado (aprobado)'), h('span', { class: 'kpi-value' }, money(s.gastadoAprobado))]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Reportado pendiente'), h('span', { class: 'kpi-value' }, money(s.reportadoPend))]),
    s.depositoPend > 0
      ? h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Depósito solicitado'), h('span', { class: 'kpi-value' }, money(s.depositoPend))])
      : null
  ]);

  // === Movimientos (solo el fondo activo) ===
  const lista = Object.entries(movs).map(([id, m]) => ({ id, ...m }))
    .filter(m => fondoDeMov(m) === fondo)
    .sort((a, b) => (Number(b.fecha) || Number(b.createdAt) || 0) - (Number(a.fecha) || Number(a.createdAt) || 0));

  const tabla = lista.length === 0
    ? h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '💵'), h('div', {}, 'Sin movimientos en esta caja.')])
    : h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
        h('table', { class: 'tbl' }, [
          h('thead', {}, [h('tr', {}, [
            h('th', {}, 'Fecha'), h('th', {}, 'Movimiento'), h('th', { class: 'num' }, 'Monto'),
            h('th', {}, 'Estado'), h('th', {}, 'Concepto'), h('th', {}, 'Origen'), h('th', {}, '')
          ])]),
          h('tbody', {}, lista.map(m => movRow(m, obraId, refresh)))
        ])
      ]);

  const obraNombre = obras[obraId]?.meta?.nombre || obraId.slice(0, 6);

  const head = h('div', { class: 'row', style: { marginBottom: '8px' } }, [
    h('h1', { style: { margin: 0 } }, 'Caja chica'),
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'btn', onClick: () => depositoDialog(obraId, refresh, fondo) },
      esEfectivo ? '+ Depósito en efectivo' : '+ Depósito'),
    h('button', { class: 'btn primary', onClick: () => gastoDialog(obraId, refresh, fondo) }, '+ Reportar gasto')
  ]);

  renderShell(crumbs, h('div', {}, [
    head,
    h('p', { class: 'muted', style: { margin: '0 0 12px' } },
      esEfectivo
        ? '💵 Fondo de efectivo de la obra (compartido con materiales). Los depósitos son billete físico que el contador saca de la caja de SOGRUB al aprobar — SÍ afectan el saldo de este fondo. Los gastos se reportan y bajan el saldo al aprobarse.'
        : 'Cada obra tiene su propia caja chica (fondo separado). Para una misma obra, el fondo es compartido con materiales (mismo saldo). Reporta aquí los gastos pagados en efectivo; el contador los aprueba en bitácora y el saldo baja cuando quedan aprobados.'),
    h('div', { class: 'row', style: { marginBottom: '14px', maxWidth: '380px' } }, [field('Obra (caja separada)', obraSel)]),
    fondoRow,
    saldoBajo ? h('div', { class: 'readonly-banner', style: { background: 'rgba(255,107,107,.08)', borderColor: 'rgba(255,107,107,.35)' } }, [
      h('span', { class: 'tag danger' }, 'Saldo bajo'),
      h('span', {}, `El saldo de ${obraNombre} (${money(s.saldo)}) está por debajo del umbral de alerta (${money(umbral)}).`)
    ]) : null,
    h('div', { class: 'card' }, [
      h('div', { class: 'row', style: { marginBottom: '4px' } }, [
        h('h3', { style: { margin: 0 } }, 'Saldo'),
        h('span', { class: 'tag accent', style: { marginLeft: '8px' } }, obraNombre)
      ]),
      kpiRow
    ]),
    h('div', { style: { marginTop: '14px' } }, tabla)
  ]));
}

const ESTADO_MOV = {
  reportado: ['warn', 'Reportado'],
  aprobado: ['ok', 'Aprobado'],
  rechazado: ['danger', 'Rechazado']
};

function movRow(m, obraId, refresh) {
  const esGasto = m.tipo === 'gasto';
  const esFondoEf = fondoDeMov(m) === 'efectivo';
  const depEstado = m.estado || 'aprobado';   // legacy default
  const estadoTag = esGasto
    ? (() => { const [cls, label] = ESTADO_MOV[m.estado] || ['', m.estado || '—']; return h('span', { class: 'tag ' + cls }, label); })()
    : esFondoEf
    ? h('span', { class: 'tag ' + (depEstado === 'aprobado' ? 'ok' : depEstado === 'rechazado' ? 'danger' : 'warn') },
        `💵 Depósito ${depEstado === 'aprobado' ? 'aprobado' : depEstado}`)
    : h('span', { class: 'tag' }, 'Depósito' + (m.metodoDeposito === 'efectivo' ? ' (efectivo informativo)' : ''));

  const propio = m.origen === 'indirectos';
  const borrable = propio && (m.tipo === 'deposito' || m.estado === 'reportado' || m.estado === 'rechazado') && m.estado !== 'aprobado';
  const acciones = borrable
    ? h('button', { class: 'btn sm ghost danger', onClick: () => borrarMov(obraId, m, refresh) }, 'Borrar')
    : null;

  return h('tr', {}, [
    h('td', { class: 'muted' }, dateMx(m.fecha || m.createdAt)),
    h('td', {}, [
      esGasto ? 'Gasto' : 'Depósito',
      m.proveedor ? h('div', { class: 'muted', style: { fontSize: '11px' } }, m.proveedor) : null
    ]),
    h('td', { class: 'num' }, [
      money(m.monto),
      esGasto ? h('div', { class: 'muted', style: { fontSize: '10px' } }, m.incluyeIva === false ? 'sin IVA' : 'con IVA') : null
    ]),
    h('td', {}, estadoTag),
    h('td', {}, m.comentario || h('span', { class: 'muted' }, '—')),
    h('td', {}, h('span', { class: 'tag ' + (propio ? 'accent' : 'muted') }, m.origen || '—')),
    h('td', {}, acciones)
  ]);
}

// === Reportar gasto ===
async function gastoDialog(obraId, refresh, fondo = 'transferencia') {
  const fecha = h('input', { type: 'date', value: todayInput() });
  const monto = h('input', { type: 'number', step: '0.01', min: '0', value: 0, onInput: recalc });
  const incluyeIva = h('input', { type: 'checkbox', checked: true, onChange: recalc });
  const ivaHint = h('span', { class: 'muted', style: { fontSize: '11px' } }, '');
  function recalc() {
    const m = Number(monto.value) || 0;
    if (incluyeIva.checked) {
      const sub = m / 1.16;
      ivaHint.textContent = `Bruto ${money(m)} = subtotal ${money(sub)} + IVA ${money(m - sub)}`;
    } else {
      ivaHint.textContent = `Sin IVA: subtotal ${money(m)} (IVA $0.00)`;
    }
  }
  recalc();
  const proveedor = h('input', { placeholder: 'Nombre del proveedor' });
  const factura = h('input', { placeholder: 'Folio/serie (opcional)' });
  const comentario = h('input', { placeholder: 'Concepto del gasto' });
  const categoria = h('select', {}, CATEGORIAS.map(c => h('option', { value: c, selected: c === 'Indirecto' }, c)));
  const ambito = h('select', {}, [h('option', { value: 'oficina' }, 'Oficina'), h('option', { value: 'campo' }, 'Campo')]);
  const ambitoWrap = h('div', {});
  function renderAmbito() {
    ambitoWrap.innerHTML = '';
    if (categoria.value === 'Indirecto') ambitoWrap.appendChild(field('Ámbito (indirecto)', ambito));
  }
  categoria.addEventListener('change', renderAmbito);
  renderAmbito();

  await modal({
    title: fondo === 'efectivo' ? '💵 Reportar gasto · fondo efectivo' : 'Reportar gasto de caja chica',
    size: 'lg',
    body: h('div', {}, [
      h('div', { class: 'grid-2' }, [field('Fecha', fecha), field('Proveedor', proveedor)]),
      h('div', { class: 'grid-2', style: { marginTop: '10px' } }, [
        field('Monto', monto),
        h('label', { class: 'row', style: { gap: '8px', alignItems: 'center', marginTop: '22px' } }, [incluyeIva, h('span', {}, 'Incluye IVA (16%)')])
      ]),
      h('div', { style: { marginTop: '4px' } }, ivaHint),
      h('div', { class: 'field', style: { marginTop: '10px' } }, [h('label', {}, 'Concepto'), comentario]),
      h('div', { class: 'grid-3', style: { marginTop: '10px' } }, [
        field('Factura', factura),
        field('Categoría sugerida', categoria),
        ambitoWrap
      ])
    ]),
    confirmLabel: 'Reportar',
    onConfirm: async () => {
      const m = Number(monto.value) || 0;
      if (m <= 0) { toast('El monto debe ser mayor a 0', 'warn'); return false; }
      if (!comentario.value.trim()) { toast('Escribe el concepto del gasto', 'warn'); return false; }
      const fechaMs = fromInputDate(fecha.value) || Date.now();
      const ahora = Date.now();
      const autor = autorActual();
      let proyectoId = null;
      try { proyectoId = await getProyectoIdByObraId(obraId); } catch { proyectoId = null; }

      const esEfectivo = fondo === 'efectivo';
      const mov = {
        tipo: 'gasto', estado: 'reportado', monto: m, fecha: fechaMs,
        comentario: comentario.value.trim(), autor, origen: 'indirectos', createdAt: ahora
      };
      if (esEfectivo) mov.fondo = 'efectivo';
      const item = {
        tipo: 'gasto_caja_chica', origenApp: 'indirectos', obraId,
        proyectoId: proyectoId || null,
        monto: m, proveedor: proveedor.value.trim() || null,
        factura: factura.value.trim() || null,
        comentario: comentario.value.trim() || null,
        fecha: fechaMs, incluyeIva: !!incluyeIva.checked,
        categoriaSugerida: categoria.value,
        ambitoSugerido: categoria.value === 'Indirecto' ? ambito.value : null,
        estado: 'recibido', creadoAt: ahora
      };
      if (esEfectivo) item.fondo = 'efectivo';
      try {
        await reportarGastoCajaChica(obraId, mov, item);
        toast('Gasto reportado', 'ok');
        refresh();
        return true;
      } catch (err) { toast('Error: ' + err.message, 'danger'); return false; }
    }
  });
}

// === Depositar ===
// Fondo transferencia: método transferencia (va al buzón, suma al aprobarse)
// o efectivo informativo (no afecta saldo, no va al buzón — legacy).
// Fondo efectivo: siempre billete físico, nace 'solicitado' y SÍ va al buzón;
// al aprobar, el contador lo saca de la caja física SOGRUB y suma al fondo.
async function depositoDialog(obraId, refresh, fondo = 'transferencia') {
  const esEfectivo = fondo === 'efectivo';
  const fecha = h('input', { type: 'date', value: todayInput() });
  const monto = h('input', { type: 'number', step: '0.01', min: '0', value: 0 });
  const comentario = h('input', { placeholder: 'Referencia / comentario (opcional)' });
  let metodo = 'transferencia';
  const chips = h('div', { class: 'chips-row' }, []);
  ['transferencia', 'efectivo'].forEach(v => {
    const c = h('button', { class: 'chip' + (metodo === v ? ' active' : ''), onClick: () => {
      metodo = v; [...chips.children].forEach(ch => ch.classList.remove('active')); c.classList.add('active');
    } }, v === 'transferencia' ? 'Transferencia' : 'Efectivo');
    chips.appendChild(c);
  });

  await modal({
    title: esEfectivo ? '💵 Depósito · fondo efectivo' : 'Depósito a caja chica',
    body: h('div', {}, [
      h('div', { class: 'grid-2' }, [field('Fecha', fecha), field('Monto', monto)]),
      esEfectivo
        ? h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '10px', lineHeight: 1.5 } },
            '💵 Billete físico al fondo de efectivo de la obra. Nace como solicitud; al aprobarla el contador la saca de la caja física de SOGRUB y SÍ suma al saldo de este fondo.')
        : h('div', { style: { marginTop: '12px' } }, [h('label', { class: 'muted', style: { fontSize: '12px' } }, 'Método'), chips]),
      h('div', { class: 'field', style: { marginTop: '4px' } }, [h('label', {}, 'Comentario'), comentario]),
      esEfectivo
        ? null
        : h('p', { class: 'muted', style: { fontSize: '11px', marginTop: '8px' } }, 'La transferencia suma al saldo y se manda al buzón para que el contador la asiente. El efectivo es solo informativo.')
    ]),
    confirmLabel: esEfectivo ? 'Solicitar depósito' : 'Registrar depósito',
    onConfirm: async () => {
      const m = Number(monto.value) || 0;
      if (m <= 0) { toast('El monto debe ser mayor a 0', 'warn'); return false; }
      const fechaMs = fromInputDate(fecha.value) || Date.now();
      const ahora = Date.now();
      const autor = autorActual();
      const mov = {
        tipo: 'deposito', monto: m, metodoDeposito: esEfectivo ? 'efectivo' : metodo,
        comentario: comentario.value.trim() || null, fecha: fechaMs,
        autor, origen: 'indirectos', createdAt: ahora
      };
      if (esEfectivo) { mov.fondo = 'efectivo'; mov.estado = 'solicitado'; }
      let item = null;
      if (esEfectivo || metodo === 'transferencia') {
        let proyectoId = null;
        try { proyectoId = await getProyectoIdByObraId(obraId); } catch { proyectoId = null; }
        item = {
          tipo: 'deposito_caja_chica', origenApp: 'indirectos', obraId,
          proyectoId: proyectoId || null, monto: m,
          metodoDeposito: esEfectivo ? 'efectivo' : 'transferencia',
          comentario: comentario.value.trim() || null, fecha: fechaMs,
          estado: 'recibido', creadoAt: ahora
        };
        if (esEfectivo) item.fondo = 'efectivo';
      }
      try {
        await depositarCajaChica(obraId, mov, item);
        toast(esEfectivo ? 'Depósito al fondo efectivo solicitado' : 'Depósito registrado', 'ok');
        refresh();
        return true;
      } catch (err) { toast('Error: ' + err.message, 'danger'); return false; }
    }
  });
}

async function borrarMov(obraId, m, refresh) {
  if (m.estado === 'aprobado') { toast('Ya fue aprobado por el contador; pídele que lo reabra.', 'warn'); return; }
  const ok = await modal({
    title: 'Borrar movimiento',
    body: `¿Borrar este ${m.tipo === 'gasto' ? 'gasto' : 'depósito'} de ${money(m.monto)}? Se quitará también su item del buzón.`,
    confirmLabel: 'Borrar', danger: true
  });
  if (!ok) return;
  try {
    await borrarMovimientoCajaChica(obraId, m.id, m.buzonItemId);
    toast('Movimiento borrado', 'ok');
    refresh();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}
