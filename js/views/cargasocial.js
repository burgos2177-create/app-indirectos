import { h, toast, modal } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import {
  listEmpleados, updateEmpleado,
  pushBuzonItem, getBuzonItem, deleteBuzonItem,
  getCargaSocialMes, setCargaSocialMes, removeCargaSocialMes,
  getProyectoIdByObraId
} from '../services/db.js';
import { money, num0, dateMx, tipoPersonalLabel } from '../util/format.js';
import { clasificacionDe } from '../util/clasificacion.js';

// IMSS: cuota mensual (todos los meses).
// INFONAVIT (+ RCV): bimestral → se cubre en los meses pares (feb, abr, …),
// según la regla: mes 1 solo IMSS, mes 2 IMSS+INFONAVIT, mes 3 solo IMSS, …

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function mesActualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const mesNumero = (mesISO) => Number((mesISO || '').split('-')[1]) || 1;
const esMesConInfonavit = (mesISO) => mesNumero(mesISO) % 2 === 0;
function mesLabel(mesISO) {
  const [y, m] = (mesISO || '').split('-');
  return `${MESES[(Number(m) || 1) - 1]} ${y}`;
}

// Vencimiento = día 17 del mes en que se envía; si ya pasó, el 17 del mes siguiente.
function vencimiento17(now = Date.now()) {
  const d = new Date(now);
  let y = d.getFullYear(), m = d.getMonth();
  if (d.getDate() > 17) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return new Date(y, m, 17).getTime();
}

export async function renderCargaSocial() {
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Carga social' }];
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando…'));

  let empleados;
  try { empleados = await listEmpleados(); }
  catch (err) { renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message)); return; }

  const empById = empleados || {};
  const rows = Object.entries(empById)
    .map(([id, e]) => ({ id, ...e }))
    .filter(e => e.activo !== false)
    .map(e => ({ id: e.id, nombre: e.nombre || '(sin nombre)', tipo: e.tipo }));

  let mesSel = mesActualISO();
  let incluirInfonavit = esMesConInfonavit(mesSel);

  // === KPIs ===
  const kImss = h('span', { class: 'kpi-value' }, '');
  const kInfo = h('span', { class: 'kpi-value' }, '');
  const kTotal = h('span', { class: 'kpi-value' }, '');
  const kpiRow = h('div', { class: 'kpi-row' }, [
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Empleados'), h('span', { class: 'kpi-value' }, num0(rows.length) + ' pers.')]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'IMSS (mensual)'), kImss]),
    h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'INFONAVIT (bimestral)'), kInfo]),
    h('div', { class: 'kpi accent' }, [h('span', { class: 'kpi-label' }, 'Total obrero-patronal del mes'), kTotal])
  ]);

  // === Controles de mes ===
  const mesInput = h('input', {
    type: 'month', value: mesSel, style: { maxWidth: '180px' },
    onChange: async () => {
      mesSel = mesInput.value || mesActualISO();
      incluirInfonavit = esMesConInfonavit(mesSel);
      infoChk.checked = incluirInfonavit;
      updateInfoBadge();
      recompute();
      await refreshEnviada();
    }
  });
  const infoChk = h('input', {
    type: 'checkbox', checked: incluirInfonavit,
    onChange: () => { incluirInfonavit = infoChk.checked; updateInfoBadge(); recompute(); }
  });
  const infoBadge = h('span', { class: 'tag' }, '');
  function updateInfoBadge() {
    infoBadge.textContent = incluirInfonavit ? 'Mes con INFONAVIT (bimestre)' : 'Solo IMSS este mes';
    infoBadge.className = 'tag ' + (incluirInfonavit ? 'accent' : 'muted');
  }
  updateInfoBadge();

  // === Tabla ===
  function fila(r) {
    const e = empById[r.id] || {};
    const c = clasificacionDe(r.tipo);
    r._imss = h('input', { type: 'number', step: '0.01', min: '0', value: Number(e.cuotaImss) || 0, class: 'cell', onInput: recompute });
    r._info = h('input', { type: 'number', step: '0.01', min: '0', value: Number(e.cuotaInfonavit) || 0, class: 'cell', onInput: recompute });
    r._total = h('td', { class: 'neto' }, '');
    return h('tr', {}, [
      h('td', {}, h('b', {}, r.nombre)),
      h('td', {}, h('span', { class: 'tag' }, tipoPersonalLabel[r.tipo] || r.tipo)),
      h('td', {}, h('span', { class: 'tag ' + (c.clasificacion === 'directo' ? 'ok' : c.ambito === 'campo' ? 'warn' : '') }, c.label)),
      h('td', { class: 'cell-td' }, r._imss),
      h('td', { class: 'cell-td' }, r._info),
      r._total
    ]);
  }
  const tbody = h('tbody', {}, rows.map(fila));
  const table = h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
    h('table', { class: 'tbl' }, [
      h('thead', {}, [h('tr', {}, [
        h('th', {}, 'Empleado'),
        h('th', {}, 'Tipo'),
        h('th', {}, 'Clasificación'),
        h('th', { class: 'num' }, 'IMSS (mensual)'),
        h('th', { class: 'num' }, 'INFONAVIT (bimestral)'),
        h('th', { class: 'num' }, 'Total del mes')
      ])]),
      tbody
    ])
  ]);

  function recompute() {
    let tImss = 0, tInfo = 0;
    for (const r of rows) {
      const imss = Number(r._imss.value) || 0;
      const info = Number(r._info.value) || 0;
      tImss += imss; tInfo += info;
      r._total.textContent = money(imss + (incluirInfonavit ? info : 0));
    }
    kImss.textContent = money(tImss);
    kInfo.textContent = incluirInfonavit ? money(tInfo) : money(tInfo) + ' (no aplica)';
    kTotal.textContent = money(tImss + (incluirInfonavit ? tInfo : 0));
  }

  // === Persistencia de cuotas ===
  async function guardarCuotas() {
    await Promise.all(rows.map(r => updateEmpleado(r.id, {
      cuotaImss: Number(r._imss.value) || 0,
      cuotaInfonavit: Number(r._info.value) || 0
    })));
  }
  const guardarBtn = h('button', { class: 'btn', onClick: async () => {
    guardarBtn.disabled = true;
    try { await guardarCuotas(); toast('Cuotas guardadas', 'ok'); }
    catch (err) { toast('Error: ' + err.message, 'danger'); }
    guardarBtn.disabled = false;
  } }, 'Guardar cuotas');

  // === Envío al buzón (buckets por clasificación) ===
  function construirBuckets() {
    const buckets = {};
    for (const r of rows) {
      const imss = Number(r._imss.value) || 0;
      const info = incluirInfonavit ? (Number(r._info.value) || 0) : 0;
      const monto = imss + info;
      if (monto <= 0) continue;
      const c = clasificacionDe(r.tipo);
      const key = c.clasificacion + '|' + (c.ambito || '');
      if (!buckets[key]) buckets[key] = { clasificacion: c.clasificacion, ambito: c.ambito, label: c.label, importe: 0, porObra: {}, sinObra: 0, empleados: [] };
      const b = buckets[key];
      b.importe += monto;
      b.empleados.push({ empleadoId: r.id, nombre: r.nombre, imss, infonavit: info });
      // prorrateo a obras según la asignación del empleado (una obra o varias)
      const oa = (empById[r.id] || {}).obrasAsignadas || {};
      const ids = Object.keys(oa);
      if (ids.length === 0) { b.sinObra += monto; }
      else {
        const sp = ids.reduce((s, id) => s + (Number(oa[id]?.peso) || 0), 0);
        for (const id of ids) {
          const peso = Number(oa[id]?.peso) || 0;
          const frac = sp > 0 ? peso / sp : 1 / ids.length;
          b.porObra[id] = (b.porObra[id] || 0) + monto * frac;
        }
      }
    }
    return Object.values(buckets);
  }

  const enviarBtn = h('button', { class: 'btn primary', onClick: enviarAlBuzon }, 'Enviar al buzón');
  const quitarBtn = h('button', { class: 'btn ghost', onClick: quitarDelBuzon }, 'Quitar del buzón');
  const enviadaBanner = h('div', {});

  async function enviarAlBuzon() {
    const buckets = construirBuckets();
    if (buckets.length === 0) { toast('No hay cuotas capturadas para enviar', 'warn'); return; }
    const venc = vencimiento17();
    const ok = await modal({
      title: 'Enviar carga social al buzón',
      body: h('div', {}, [
        h('p', {}, `Se enviarán ${buckets.length} movimiento(s) de ${mesLabel(mesSel)} al buzón de contabilidad, separados por clasificación (${buckets.map(b => b.label).join(', ')}).`),
        h('p', { class: 'muted', style: { fontSize: '12px' } }, `Vence el ${dateMx(venc)} (día 17). ${incluirInfonavit ? 'Incluye IMSS + INFONAVIT.' : 'Solo IMSS.'}`)
      ]),
      confirmLabel: 'Enviar'
    });
    if (!ok) return;
    enviarBtn.disabled = true; enviarBtn.innerHTML = '<span class="spinner"></span> Enviando…';
    try {
      await guardarCuotas();
      const ids = [];
      for (const b of buckets) {
        const porObra = {};
        const proyectoPorObra = {};
        for (const k of Object.keys(b.porObra)) {
          porObra[k] = round2(b.porObra[k]);
          proyectoPorObra[k] = await getProyectoIdByObraId(k).catch(() => null);
        }
        const item = {
          tipo: 'carga_social', origenApp: 'indirectos', estado: 'recibido', creadoPor: state.user?.uid || null,
          concepto: `Carga social ${mesLabel(mesSel)} · ${b.label}${incluirInfonavit ? ' (IMSS+INFONAVIT)' : ' (IMSS)'}`,
          fecha: `${mesSel}-01`,
          fechaVencimiento: venc,
          monto: { subtotal: round2(b.importe), iva: 0, importe: round2(b.importe) },
          clasificacion: b.clasificacion, ambito: b.ambito,
          mes: mesSel, incluyeInfonavit: incluirInfonavit,
          prorrateoPorObra: porObra, proyectoPorObra, sinObra: round2(b.sinObra),
          empleados: b.empleados
        };
        ids.push(await pushBuzonItem(item));
      }
      await setCargaSocialMes(mesSel, {
        enviadaAt: Date.now(), buzonItemIds: ids, incluyeInfonavit,
        total: round2(buckets.reduce((s, b) => s + b.importe, 0)), enviadaPor: state.user?.uid || null
      });
      toast(`Carga social enviada (${ids.length} movimiento(s))`, 'ok');
      await refreshEnviada();
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
    enviarBtn.disabled = false; enviarBtn.textContent = 'Enviar al buzón';
  }

  async function quitarDelBuzon() {
    const rec = await getCargaSocialMes(mesSel);
    const ids = rec?.buzonItemIds || [];
    for (const id of ids) {
      let item = null;
      try { item = await getBuzonItem(id); } catch { item = null; }
      if (item && item.estado && item.estado !== 'recibido') {
        toast('Contabilidad ya procesó esta carga social; no se puede quitar.', 'warn');
        return;
      }
    }
    const ok = await modal({ title: 'Quitar del buzón', body: 'Se quitarán los movimientos de carga social de este mes. ¿Continuar?', confirmLabel: 'Quitar' });
    if (!ok) return;
    try {
      for (const id of ids) { try { await deleteBuzonItem(id); } catch { /* ignore */ } }
      await removeCargaSocialMes(mesSel);
      toast('Carga social quitada del buzón', 'ok');
      await refreshEnviada();
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  }

  async function refreshEnviada() {
    let rec = null;
    try { rec = await getCargaSocialMes(mesSel); } catch { rec = null; }
    enviadaBanner.innerHTML = '';
    if (rec) {
      enviadaBanner.appendChild(h('div', { class: 'readonly-banner' }, [
        h('span', { class: 'tag ok' }, 'Enviada'),
        h('span', {}, `Carga social de ${mesLabel(mesSel)} enviada al buzón el ${dateMx(rec.enviadaAt)} (${(rec.buzonItemIds || []).length} movimiento(s)).`)
      ]));
      enviarBtn.classList.add('hidden');
      quitarBtn.classList.remove('hidden');
    } else {
      enviarBtn.classList.remove('hidden');
      quitarBtn.classList.add('hidden');
    }
  }

  recompute();

  const body = rows.length === 0
    ? h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '🧾'), h('div', {}, 'No hay empleados activos.')])
    : h('div', {}, [
        enviadaBanner,
        h('div', { class: 'card' }, [h('h3', {}, 'Resumen del mes'), kpiRow]),
        h('div', { style: { marginTop: '14px' } }, table),
        h('div', { class: 'row', style: { marginTop: '14px', justifyContent: 'flex-end' } }, [guardarBtn, quitarBtn, enviarBtn])
      ]);

  renderShell(crumbs, h('div', {}, [
    h('h1', {}, 'Carga social (cuotas obrero-patronal)'),
    h('p', { class: 'muted', style: { margin: '0 0 12px' } },
      'Captura por empleado la cuota estimada de IMSS (mensual) e INFONAVIT (bimestral). Al enviar, se separa por clasificación contable (costo directo para operativos; indirecto de campo/oficina para técnicos y directivo) y vence el día 17.'),
    h('div', { class: 'row', style: { marginBottom: '16px', gap: '12px' } }, [
      h('div', { class: 'field', style: { maxWidth: '180px' } }, [h('label', {}, 'Mes'), mesInput]),
      h('label', { class: 'row', style: { gap: '6px', cursor: 'pointer', marginTop: '18px' } }, [infoChk, h('span', { class: 'muted' }, 'Incluir INFONAVIT')]),
      h('div', { style: { marginTop: '18px' } }, infoBadge)
    ]),
    body
  ]));

  refreshEnviada();
}
