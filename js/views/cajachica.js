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
function calcSaldo(movs) {
  let saldo = 0, depositado = 0, gastadoAprobado = 0, reportadoPend = 0;
  for (const m of Object.values(movs || {})) {
    const monto = Number(m.monto) || 0;
    if (m.tipo === 'deposito') {
      const metodo = m.metodoDeposito || 'transferencia';
      if (metodo === 'efectivo') continue; // informativo, no afecta saldo
      saldo += monto; depositado += monto;
    } else if (m.tipo === 'gasto') {
      if (m.estado === 'aprobado') { saldo -= monto; gastadoAprobado += monto; }
      else if (m.estado === 'reportado') { reportadoPend += monto; }
      // rechazado: no afecta
    }
  }
  return { saldo, depositado, gastadoAprobado, reportadoPend };
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

  let caja;
  try { caja = await getCajaChica(obraId); }
  catch (err) { renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message)); return; }

  const movs = caja?.movimientos || {};
  const meta = caja?.meta || {};
  const umbral = Number(meta.umbralAlerta) || 1000;
  const s = calcSaldo(movs);

  const refresh = () => renderCajaChica({ query: { obra: obraId } });

  // === Selector de obra ===
  const obraSel = h('select', {
    value: obraId,
    onChange: () => navigate('/caja-chica?obra=' + obraSel.value)
  }, obraIds.map(oid => h('option', { value: oid, selected: oid === obraId }, obras[oid]?.meta?.nombre || oid.slice(0, 6))));

  // === Saldo ===
  const saldoBajo = s.saldo < umbral;
  const kpiRow = h('div', { class: 'kpi-row' }, [
    h('div', { class: 'kpi ' + (saldoBajo ? '' : 'accent') }, [h('span', { class: 'kpi-label' }, 'Saldo conciliado'), h('span', { class: 'kpi-value', style: saldoBajo ? { color: 'var(--danger)' } : {} }, money(s.saldo))]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Depositado (transfer.)'), h('span', { class: 'kpi-value' }, money(s.depositado))]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Gastado (aprobado)'), h('span', { class: 'kpi-value' }, money(s.gastadoAprobado))]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Reportado pendiente'), h('span', { class: 'kpi-value' }, money(s.reportadoPend))])
  ]);

  // === Movimientos ===
  const lista = Object.entries(movs).map(([id, m]) => ({ id, ...m }))
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

  const head = h('div', { class: 'row', style: { marginBottom: '8px' } }, [
    h('h1', { style: { margin: 0 } }, 'Caja chica'),
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'btn', onClick: () => depositoDialog(obraId, refresh) }, '+ Depósito'),
    h('button', { class: 'btn primary', onClick: () => gastoDialog(obraId, refresh) }, '+ Reportar gasto')
  ]);

  renderShell(crumbs, h('div', {}, [
    head,
    h('p', { class: 'muted', style: { margin: '0 0 12px' } },
      'Fondo físico de la obra (compartido con materiales). Reporta aquí los gastos pagados en efectivo; el contador los aprueba en bitácora. El saldo baja cuando el gasto queda aprobado.'),
    h('div', { class: 'row', style: { marginBottom: '14px', maxWidth: '380px' } }, [field('Obra', obraSel)]),
    saldoBajo ? h('div', { class: 'readonly-banner', style: { background: 'rgba(255,107,107,.08)', borderColor: 'rgba(255,107,107,.35)' } }, [
      h('span', { class: 'tag danger' }, 'Saldo bajo'),
      h('span', {}, `El saldo (${money(s.saldo)}) está por debajo del umbral de alerta (${money(umbral)}).`)
    ]) : null,
    h('div', { class: 'card' }, [h('h3', {}, 'Saldo'), kpiRow]),
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
  const estadoTag = esGasto
    ? (() => { const [cls, label] = ESTADO_MOV[m.estado] || ['', m.estado || '—']; return h('span', { class: 'tag ' + cls }, label); })()
    : h('span', { class: 'tag' }, 'Depósito' + (m.metodoDeposito === 'efectivo' ? ' (efectivo)' : ''));

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
async function gastoDialog(obraId, refresh) {
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
    title: 'Reportar gasto de caja chica',
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

      const mov = {
        tipo: 'gasto', estado: 'reportado', monto: m, fecha: fechaMs,
        comentario: comentario.value.trim(), autor, origen: 'indirectos', createdAt: ahora
      };
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
async function depositoDialog(obraId, refresh) {
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
    title: 'Depósito a caja chica',
    body: h('div', {}, [
      h('div', { class: 'grid-2' }, [field('Fecha', fecha), field('Monto', monto)]),
      h('div', { style: { marginTop: '12px' } }, [h('label', { class: 'muted', style: { fontSize: '12px' } }, 'Método'), chips]),
      h('div', { class: 'field', style: { marginTop: '4px' } }, [h('label', {}, 'Comentario'), comentario]),
      h('p', { class: 'muted', style: { fontSize: '11px', marginTop: '8px' } }, 'La transferencia suma al saldo y se manda al buzón para que el contador la asiente. El efectivo es solo informativo.')
    ]),
    confirmLabel: 'Registrar depósito',
    onConfirm: async () => {
      const m = Number(monto.value) || 0;
      if (m <= 0) { toast('El monto debe ser mayor a 0', 'warn'); return false; }
      const fechaMs = fromInputDate(fecha.value) || Date.now();
      const ahora = Date.now();
      const autor = autorActual();
      const mov = {
        tipo: 'deposito', monto: m, metodoDeposito: metodo,
        comentario: comentario.value.trim() || null, fecha: fechaMs,
        autor, origen: 'indirectos', createdAt: ahora
      };
      let item = null;
      if (metodo === 'transferencia') {
        let proyectoId = null;
        try { proyectoId = await getProyectoIdByObraId(obraId); } catch { proyectoId = null; }
        item = {
          tipo: 'deposito_caja_chica', origenApp: 'indirectos', obraId,
          proyectoId: proyectoId || null, monto: m, metodoDeposito: 'transferencia',
          comentario: comentario.value.trim() || null, fecha: fechaMs,
          estado: 'recibido', creadoAt: ahora
        };
      }
      try {
        await depositarCajaChica(obraId, mov, item);
        toast('Depósito registrado', 'ok');
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
