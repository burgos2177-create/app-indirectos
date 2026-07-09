import { h, toast } from '../util/dom.js';
import { renderShell } from './shell.js';
import { listEmpleados, updateEmpleado } from '../services/db.js';
import { money, num0, tipoPersonalLabel } from '../util/format.js';

// IMSS: cuota mensual (todos los meses).
// INFONAVIT (+ RCV): cuota bimestral, se cubre una vez por bimestre → en los
// meses pares (feb, abr, jun, ago, oct, dic), según la regla del usuario:
//   mes 1 solo IMSS, mes 2 IMSS+INFONAVIT, mes 3 solo IMSS, ...

function mesActualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function mesNumero(mesISO) {
  const m = Number((mesISO || '').split('-')[1]) || 1;
  return m;
}
const esMesConInfonavit = (mesISO) => mesNumero(mesISO) % 2 === 0;

export async function renderCargaSocial() {
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Carga social' }];
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando…'));

  let empleados;
  try { empleados = await listEmpleados(); }
  catch (err) { renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message)); return; }

  const rows = Object.entries(empleados || {})
    .map(([id, e]) => ({ id, ...e }))
    .filter(e => e.activo !== false)
    .map(e => ({ id: e.id, nombre: e.nombre || '(sin nombre)', tipo: e.tipo }));

  // Prefill de inputs desde el catálogo.
  const empById = empleados || {};

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
    onChange: () => {
      mesSel = mesInput.value || mesActualISO();
      incluirInfonavit = esMesConInfonavit(mesSel);
      infoChk.checked = incluirInfonavit;
      updateInfoBadge();
      recompute();
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
    r._imss = h('input', { type: 'number', step: '0.01', min: '0', value: Number(e.cuotaImss) || 0, class: 'cell', onInput: recompute });
    r._info = h('input', { type: 'number', step: '0.01', min: '0', value: Number(e.cuotaInfonavit) || 0, class: 'cell', onInput: recompute });
    r._total = h('td', { class: 'neto' }, '');
    return h('tr', {}, [
      h('td', {}, h('b', {}, r.nombre)),
      h('td', {}, h('span', { class: 'tag' }, tipoPersonalLabel[r.tipo] || r.tipo)),
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

  const guardarBtn = h('button', { class: 'btn primary', onClick: guardar }, 'Guardar cuotas');
  async function guardar() {
    guardarBtn.disabled = true; guardarBtn.innerHTML = '<span class="spinner"></span> Guardando…';
    try {
      await Promise.all(rows.map(r => updateEmpleado(r.id, {
        cuotaImss: Number(r._imss.value) || 0,
        cuotaInfonavit: Number(r._info.value) || 0
      })));
      toast('Cuotas guardadas', 'ok');
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
    guardarBtn.disabled = false; guardarBtn.textContent = 'Guardar cuotas';
  }

  recompute();

  const body = rows.length === 0
    ? h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '🧾'), h('div', {}, 'No hay empleados activos.')])
    : h('div', {}, [
        h('div', { class: 'card' }, [h('h3', {}, 'Resumen del mes'), kpiRow]),
        h('div', { style: { marginTop: '14px' } }, table),
        h('div', { class: 'row', style: { marginTop: '14px', justifyContent: 'flex-end' } }, [guardarBtn])
      ]);

  renderShell(crumbs, h('div', {}, [
    h('h1', {}, 'Carga social (cuotas obrero-patronal)'),
    h('p', { class: 'muted', style: { margin: '0 0 12px' } },
      'Captura por empleado la cuota estimada de IMSS (mensual) e INFONAVIT (bimestral). El IMSS se cubre todos los meses; el INFONAVIT solo en los meses con bimestre (pares).'),
    h('div', { class: 'row', style: { marginBottom: '16px', gap: '12px' } }, [
      h('div', { class: 'field', style: { maxWidth: '180px' } }, [h('label', {}, 'Mes'), mesInput]),
      h('label', { class: 'row', style: { gap: '6px', cursor: 'pointer', marginTop: '18px' } }, [infoChk, h('span', { class: 'muted' }, 'Incluir INFONAVIT')]),
      h('div', { style: { marginTop: '18px' } }, infoBadge)
    ]),
    body
  ]));
}
