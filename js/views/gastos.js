import { h, toast, modal } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import {
  listGastos, createGasto, updateGasto, removeGasto,
  listCategoriasGasto, listObrasLegacy,
  pushBuzonItem, getBuzonItem, deleteBuzonItem, getProyectoIdByObraId
} from '../services/db.js';
import { money, dateMx, num2 } from '../util/format.js';

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function field(label, el, hint) {
  return h('div', { class: 'field' }, [h('label', {}, label), el, hint ? h('span', { class: 'muted', style: { fontSize: '11px' } }, hint) : null]);
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Normaliza el monto de un gasto a { subtotal, iva, importe }.
// Compatibilidad: si `monto` fuera un número plano, lo trata como importe sin IVA.
function montoObj(g) {
  const m = g?.monto;
  if (m && typeof m === 'object') {
    const subtotal = Number(m.subtotal) || 0;
    const iva = Number(m.iva) || 0;
    const importe = m.importe != null ? Number(m.importe) || 0 : round2(subtotal + iva);
    return { subtotal, iva, importe };
  }
  const n = Number(m) || 0;
  return { subtotal: n, iva: 0, importe: n };
}
const montoImporte = (g) => montoObj(g).importe;

const MODO_LABEL = {
  obra_unica: 'Obra única',
  prorrateo_obras: 'Prorrateo',
  sogrub_empresa: 'Empresa SOGRUB'
};

// Ámbito del indirecto — contabilidad separa oficina de campo. Lo definimos aquí
// para que llegue ya clasificado al buzón.
const AMBITO_LABEL = { oficina: 'Oficina', campo: 'Campo' };
const ambitoLabel = (a) => AMBITO_LABEL[a] || '—';

export async function renderGastos() {
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Gastos' }];
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando gastos…'));

  let gastos, categorias, obras;
  try {
    [gastos, categorias, obras] = await Promise.all([listGastos(), listCategoriasGasto(), listObrasLegacy()]);
  } catch (err) {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message));
    return;
  }
  const catActivas = categorias.filter(c => c.activa !== false);
  const list = Object.entries(gastos || {}).map(([id, g]) => ({ id, ...g }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const refresh = () => renderGastos();

  const head = h('div', { class: 'row', style: { marginBottom: '8px' } }, [
    h('h1', { style: { margin: 0 } }, 'Gastos indirectos'),
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'btn primary', onClick: () => gastoDialog({ cats: catActivas, obras, onDone: refresh }) }, '+ Nuevo gasto')
  ]);
  const intro = h('p', { class: 'muted', style: { margin: '0 0 16px' } },
    'Captura suelta de gastos: oficina, gasolina, servicios, etc. Cada gasto se atribuye a una obra, se prorratea entre varias, o se carga a la empresa. Al enviarlo, el contador lo aprueba en bitácora.');

  const total = list.reduce((s, g) => s + montoImporte(g), 0);

  const body = list.length === 0
    ? h('div', { class: 'empty' }, [
        h('div', { class: 'ico' }, '💸'),
        h('div', {}, 'No hay gastos capturados. Crea el primero.')
      ])
    : gastosTable(list, obras, catActivas, refresh);

  renderShell(crumbs, h('div', {}, [
    head, intro,
    catActivas.length === 0
      ? h('div', { class: 'card', style: { marginBottom: '14px' } },
          h('div', { class: 'muted' }, 'No hay categorías de gasto activas. Pide al administrador que las configure en Categorías.'))
      : null,
    body,
    list.length ? h('p', { class: 'muted', style: { marginTop: '10px', textAlign: 'right' } }, `Total capturado: ${money(total)}`) : null
  ]));
}

function atribucionTxt(g, obras) {
  if (g.modo === 'obra_unica') {
    const nombre = obras[g.obraId]?.meta?.nombre || (g.obraId ? g.obraId.slice(0, 6) : '—');
    return nombre + (g.conceptoKey ? ` · ${g.conceptoKey}` : '');
  }
  if (g.modo === 'prorrateo_obras') return `Prorrateo (${Object.keys(g.prorrateo || {}).length} obras)`;
  return 'Empresa SOGRUB';
}

function gastosTable(rows, obras, cats, refresh) {
  return h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
    h('table', { class: 'tbl' }, [
      h('thead', {}, [h('tr', {}, [
        h('th', {}, 'Fecha'),
        h('th', {}, 'Categoría'),
        h('th', {}, 'Ámbito'),
        h('th', {}, 'Concepto'),
        h('th', { class: 'num' }, 'Monto'),
        h('th', {}, 'Atribución'),
        h('th', {}, 'Estado'),
        h('th', {}, '')
      ])]),
      h('tbody', {}, rows.map(g => gastoRow(g, obras, cats, refresh)))
    ])
  ]);
}

function gastoRow(g, obras, cats, refresh) {
  const enviado = g.estado === 'enviado';
  const acciones = enviado
    ? h('div', { class: 'row' }, [
        h('button', { class: 'btn sm ghost', onClick: () => quitarDelBuzon(g, refresh) }, 'Quitar del buzón')
      ])
    : h('div', { class: 'row' }, [
        h('button', { class: 'btn sm ghost', onClick: () => enviarGasto(g, refresh) }, 'Enviar al buzón'),
        h('button', { class: 'btn sm ghost', onClick: () => gastoDialog({ cats, obras, gasto: g, onDone: refresh }) }, 'Editar'),
        h('button', { class: 'btn sm ghost danger', onClick: () => eliminarGasto(g, refresh) }, '✕')
      ]);
  return h('tr', {}, [
    h('td', { class: 'muted' }, dateMx(g.fechaISO)),
    h('td', {}, h('span', { class: 'tag' }, g.categoriaNombre || g.categoria || '—')),
    h('td', {}, g.ambito
      ? h('span', { class: 'tag ' + (g.ambito === 'campo' ? 'warn' : '') }, ambitoLabel(g.ambito))
      : h('span', { class: 'muted' }, '—')),
    h('td', {}, [
      g.concepto || '—',
      g.proveedorNombre ? h('div', { class: 'muted', style: { fontSize: '11px' } }, g.proveedorNombre) : null
    ]),
    h('td', { class: 'num' }, money(montoImporte(g))),
    h('td', { class: 'muted' }, atribucionTxt(g, obras)),
    h('td', {}, enviado
      ? h('span', { class: 'tag ok' }, 'Enviado')
      : h('span', { class: 'tag warn' }, 'Borrador')),
    h('td', {}, acciones)
  ]);
}

// Editor de pesos reutilizable para el modo prorrateo.
function pesosEditor(obras, initial = {}) {
  const data = {};
  for (const [k, v] of Object.entries(initial)) data[k] = Number(v) || 0;
  const uiRefs = {};
  const sumaBadge = h('span', { class: 'tag' }, 'Σ 0%');
  function refresh() {
    const ids = Object.keys(data);
    const s = ids.reduce((a, id) => a + (Number(data[id]) || 0), 0);
    sumaBadge.textContent = `Σ ${num2(s)}%`;
    sumaBadge.className = 'tag ' + (ids.length === 0 ? '' : Math.abs(s - 100) < 0.01 ? 'ok' : 'warn');
  }
  const filas = Object.entries(obras).map(([oid, o]) => {
    const checked = data[oid] != null;
    const cb = h('input', { type: 'checkbox', checked, onChange: () => {
      if (cb.checked) { data[oid] = Number(inp.value) || 0; inp.disabled = false; }
      else { delete data[oid]; inp.disabled = true; }
      refresh();
    } });
    const inp = h('input', {
      type: 'number', step: '0.01', min: '0', max: '100',
      value: data[oid] || 0, disabled: !checked, style: { width: '80px' },
      onInput: () => { if (data[oid] != null) data[oid] = Number(inp.value) || 0; refresh(); }
    });
    uiRefs[oid] = { cb, inp };
    return h('label', { class: 'peso-row' }, [
      cb,
      h('div', { class: 'peso-info' }, [h('div', { class: 'peso-nombre' }, o.meta?.nombre || oid.slice(0, 6))]),
      h('div', { class: 'peso-input-wrap' }, [inp, h('span', { class: 'muted' }, '%')])
    ]);
  });
  function distribuir() {
    const ids = Object.keys(data);
    if (ids.length === 0) { toast('Marca al menos una obra', 'warn'); return; }
    const p = Math.round((100 / ids.length) * 100) / 100;
    const resto = 100 - p * ids.length;
    ids.forEach((id, i) => { const v = i === 0 ? Math.round((p + resto) * 100) / 100 : p; data[id] = v; uiRefs[id].inp.value = String(v); });
    refresh();
  }
  const el = h('div', {}, [
    h('div', { class: 'pesos-grid' }, filas),
    h('div', { class: 'row', style: { marginTop: '8px' } }, [
      h('div', {}, 'Suma: '), sumaBadge,
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn ghost sm', onClick: distribuir }, 'Distribuir parejo')
    ])
  ]);
  refresh();
  return {
    el,
    getData: () => ({ ...data }),
    validate: () => {
      const ids = Object.keys(data);
      if (ids.length === 0) return 'Selecciona al menos una obra';
      const s = ids.reduce((a, id) => a + (Number(data[id]) || 0), 0);
      if (Math.abs(s - 100) > 0.01) return `La suma de pesos debe ser 100% (actual ${num2(s)}%)`;
      return null;
    }
  };
}

async function gastoDialog({ cats, obras, gasto = null, onDone }) {
  if (cats.length === 0) { toast('No hay categorías activas. Configúralas primero.', 'warn'); return; }
  const isEdit = !!gasto;
  const obrasIds = Object.keys(obras || {});

  const M0 = montoObj(gasto || {});
  const fecha = h('input', { type: 'date', value: gasto?.fechaISO || todayISO() });
  const categoria = h('select', {}, cats.map(c => h('option', { value: c.id, selected: gasto?.categoria === c.id }, c.nombre)));
  const concepto = h('input', { value: gasto?.concepto || '', placeholder: 'Ej. Recibo CFE oficina' });
  const proveedor = h('input', { value: gasto?.proveedorNombre || '', placeholder: 'Proveedor (opcional)' });

  // Monto desglosado: subtotal + IVA = importe (contrato del buzón de contabilidad).
  const subtotal = h('input', { type: 'number', step: '0.01', min: '0', value: M0.subtotal || 0, onInput: recalcImporte });
  const iva = h('input', { type: 'number', step: '0.01', min: '0', value: M0.iva || 0, onInput: recalcImporte });
  const importeLbl = h('b', {}, money(M0.importe || 0));
  function recalcImporte() { importeLbl.textContent = money((Number(subtotal.value) || 0) + (Number(iva.value) || 0)); }
  const iva16Btn = h('button', { class: 'btn ghost sm', onClick: () => { iva.value = String(round2((Number(subtotal.value) || 0) * 0.16)); recalcImporte(); } }, 'IVA 16%');

  const obraSel = h('select', {}, [
    h('option', { value: '' }, '— elige obra —'),
    ...Object.entries(obras).map(([oid, o]) => h('option', { value: oid, selected: gasto?.obraId === oid }, o.meta?.nombre || oid.slice(0, 6)))
  ]);
  const conceptoKey = h('input', { value: gasto?.conceptoKey || '', placeholder: 'conceptoKey OPUS (opcional)' });

  let modo = gasto?.modo || 'obra_unica';
  let pe = null;
  const extra = h('div', { style: { marginTop: '10px' } });

  function renderExtra() {
    extra.innerHTML = '';
    if (modo === 'obra_unica') {
      extra.appendChild(obrasIds.length === 0
        ? h('div', { class: 'muted', style: { fontSize: '12px' } }, 'No hay obras creadas. Créalas en la app de estimaciones, o usa el modo Empresa.')
        : h('div', { class: 'grid-2' }, [field('Obra', obraSel), field('Concepto OPUS (opcional)', conceptoKey, 'Si el gasto corresponde a un concepto del catálogo OPUS de la obra.')]));
    } else if (modo === 'prorrateo_obras') {
      if (obrasIds.length === 0) {
        extra.appendChild(h('div', { class: 'muted', style: { fontSize: '12px' } }, 'No hay obras para prorratear.'));
        pe = null;
      } else {
        pe = pesosEditor(obras, gasto?.prorrateo || {});
        extra.appendChild(h('div', {}, [
          h('p', { class: 'muted', style: { fontSize: '12px', margin: '0 0 8px' } }, 'Reparte el gasto entre las obras por peso (suma 100%).'),
          pe.el
        ]));
      }
    } else {
      extra.appendChild(h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Gasto de la empresa SOGRUB, sin obra. Bitácora lo registra como egreso Mifel.'));
    }
  }

  const modoChips = h('div', { class: 'chips-row' }, []);
  ['obra_unica', 'prorrateo_obras', 'sogrub_empresa'].forEach(val => {
    const c = h('button', { class: 'chip' + (modo === val ? ' active' : ''), onClick: () => {
      modo = val;
      [...modoChips.children].forEach(ch => ch.classList.remove('active'));
      c.classList.add('active');
      renderExtra();
    } }, MODO_LABEL[val]);
    modoChips.appendChild(c);
  });
  renderExtra();

  // Ámbito del indirecto (oficina / campo).
  let ambito = gasto?.ambito || 'oficina';
  const ambitoChips = h('div', { class: 'chips-row' }, []);
  ['oficina', 'campo'].forEach(val => {
    const c = h('button', { class: 'chip' + (ambito === val ? ' active' : ''), onClick: () => {
      ambito = val;
      [...ambitoChips.children].forEach(ch => ch.classList.remove('active'));
      c.classList.add('active');
    } }, AMBITO_LABEL[val]);
    ambitoChips.appendChild(c);
  });

  await modal({
    title: isEdit ? 'Editar gasto' : 'Nuevo gasto indirecto',
    size: 'lg',
    body: h('div', {}, [
      h('div', { class: 'grid-2' }, [field('Fecha', fecha), field('Categoría', categoria)]),
      h('div', { style: { marginTop: '12px' } }, [
        h('label', { class: 'muted', style: { fontSize: '12px' } }, 'Ámbito del indirecto'),
        ambitoChips,
        h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Contabilidad separa los indirectos de oficina de los de campo; se envía ya clasificado.')
      ]),
      h('div', { class: 'grid-2', style: { marginTop: '10px' } }, [field('Concepto', concepto), field('Proveedor', proveedor)]),
      h('div', { class: 'grid-3', style: { marginTop: '10px' } }, [
        field('Subtotal', subtotal),
        h('div', { class: 'field' }, [
          h('label', {}, ['IVA  ', iva16Btn]),
          iva
        ]),
        h('div', { class: 'field' }, [h('label', {}, 'Importe total'), h('div', { style: { padding: '8px 0' } }, importeLbl)])
      ]),
      h('div', { style: { marginTop: '12px' } }, [
        h('label', { class: 'muted', style: { fontSize: '12px' } }, 'Atribución'),
        modoChips
      ]),
      extra
    ]),
    confirmLabel: isEdit ? 'Guardar' : 'Crear',
    onConfirm: async () => {
      const sub = round2(subtotal.value);
      const ivaV = round2(iva.value);
      const importe = round2(sub + ivaV);
      if (!concepto.value.trim()) { toast('Concepto obligatorio', 'warn'); return false; }
      if (importe <= 0) { toast('El importe debe ser mayor a 0', 'warn'); return false; }
      let obraId = null, ck = null, prorrateo = null;
      if (modo === 'obra_unica') {
        obraId = obraSel.value || '';
        if (!obraId) { toast('Elige una obra', 'warn'); return false; }
        ck = conceptoKey.value.trim() || null;
      } else if (modo === 'prorrateo_obras') {
        if (!pe) { toast('No hay obras para prorratear', 'warn'); return false; }
        const err = pe.validate();
        if (err) { toast(err, 'warn'); return false; }
        prorrateo = pe.getData();
      }
      const cat = cats.find(c => c.id === categoria.value);
      const record = {
        fechaISO: fecha.value || todayISO(),
        categoria: categoria.value,
        categoriaNombre: cat?.nombre || categoria.value,
        concepto: concepto.value.trim(),
        proveedorNombre: proveedor.value.trim() || null,
        ambito,
        monto: { subtotal: sub, iva: ivaV, importe },
        modo,
        obraId, conceptoKey: ck, prorrateo,
        estado: gasto?.estado || 'borrador',
        createdBy: state.user?.uid || null
      };
      try {
        if (isEdit) await updateGasto(gasto.id, record);
        else await createGasto(record);
        toast(isEdit ? 'Gasto actualizado' : 'Gasto creado', 'ok');
        onDone();
        return true;
      } catch (err) { toast('Error: ' + err.message, 'danger'); return false; }
    }
  });
}

// Construye los item(s) del buzón según el contrato de contabilidad:
//   { tipo, origenApp, obraId, concepto, monto:{subtotal,iva,importe},
//     fecha:"YYYY-MM-DD", estado:"recibido", creadoPor, creadoAt,
//     ambito:"oficina"|"campo" }
//   opcionales: proveedorNombre, conceptoKey, desglose[]
// - obra_unica      → 1 item con obraId.
// - prorrateo_obras → N items (uno por obra) con su porción del monto → N movimientos de proyecto.
// - sogrub_empresa  → 1 item sin obra (empresa=true) → egreso Mifel.
async function buildBuzonItems(g) {
  const M = montoObj(g);
  const base = {
    tipo: 'gasto_indirecto',
    origenApp: 'indirectos',
    concepto: g.concepto,
    fecha: g.fechaISO,
    estado: 'recibido',
    creadoPor: state.user?.uid || null,
    ambito: g.ambito || 'oficina',
    categoria: g.categoria,
    categoriaNombre: g.categoriaNombre,
    gastoId: g.id
  };
  if (g.proveedorNombre) base.proveedorNombre = g.proveedorNombre;

  if (g.modo === 'obra_unica') {
    const it = { ...base, obraId: g.obraId, proyectoId: await getProyectoIdByObraId(g.obraId).catch(() => null), monto: { ...M } };
    if (g.conceptoKey) it.conceptoKey = g.conceptoKey;
    return [it];
  }
  if (g.modo === 'sogrub_empresa') {
    return [{ ...base, obraId: null, empresa: true, monto: { ...M } }];
  }
  // prorrateo_obras
  const entries = Object.entries(g.prorrateo || {});
  const sumPeso = entries.reduce((s, [, p]) => s + (Number(p) || 0), 0) || 1;
  const out = [];
  for (const [oid, peso] of entries) {
    const frac = (Number(peso) || 0) / sumPeso;
    out.push({
      ...base,
      obraId: oid,
      proyectoId: await getProyectoIdByObraId(oid).catch(() => null),
      concepto: `${g.concepto} (prorrateo ${num2(peso)}%)`,
      monto: {
        subtotal: round2(M.subtotal * frac),
        iva: round2(M.iva * frac),
        importe: round2(M.importe * frac)
      },
      prorrateoPeso: Number(peso) || 0
    });
  }
  return out;
}

function buzonIdsDe(g) {
  if (Array.isArray(g.buzonItemIds)) return g.buzonItemIds.filter(Boolean);
  return g.buzonItemId ? [g.buzonItemId] : [];
}

async function enviarGasto(g, onDone) {
  try {
    const items = await buildBuzonItems(g);
    if (items.length === 0) { toast('No hay obras/atribución para enviar', 'warn'); return; }
    const ids = [];
    for (const it of items) ids.push(await pushBuzonItem(it));
    await updateGasto(g.id, { estado: 'enviado', buzonItemIds: ids, buzonItemId: null });
    toast(ids.length > 1 ? `Gasto enviado al buzón (${ids.length} movimientos)` : 'Gasto enviado al buzón', 'ok');
    onDone();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}

async function quitarDelBuzon(g, onDone) {
  const ids = buzonIdsDe(g);
  for (const id of ids) {
    let item = null;
    try { item = await getBuzonItem(id); } catch { item = null; }
    if (item && item.estado && item.estado !== 'recibido') {
      toast('Contabilidad ya procesó este gasto; no se puede quitar.', 'warn');
      return;
    }
  }
  const ok = await modal({
    title: 'Quitar del buzón',
    body: 'El gasto volverá a borrador y se quitará del buzón de contabilidad. ¿Continuar?',
    confirmLabel: 'Quitar'
  });
  if (!ok) return;
  try {
    for (const id of ids) { try { await deleteBuzonItem(id); } catch { /* ignore */ } }
    await updateGasto(g.id, { estado: 'borrador', buzonItemIds: null, buzonItemId: null });
    toast('Gasto regresado a borrador', 'ok');
    onDone();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}

async function eliminarGasto(g, onDone) {
  const ok = await modal({
    title: 'Eliminar gasto',
    body: `¿Eliminar "${g.concepto || 'este gasto'}" (${money(montoImporte(g))})? Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar', danger: true
  });
  if (!ok) return;
  try {
    for (const id of buzonIdsDe(g)) { try { await deleteBuzonItem(id); } catch { /* ignore */ } }
    await removeGasto(g.id);
    toast('Gasto eliminado', 'ok');
    onDone();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}
