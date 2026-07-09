import { h, toast } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import { getMeta, updateMeta } from '../services/db.js';
import { periodoSemanal, nombreDia } from '../util/calendario.js';

const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

export async function renderConfiguracion() {
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Configuración' }];
  if (state.user?.role !== 'admin') {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Solo el administrador puede cambiar la configuración del calendario.'));
    return;
  }
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando configuración…'));

  let meta;
  try { meta = await getMeta(); }
  catch (err) { renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message)); return; }

  const cal = meta.calendarioSemanal || { diaInicio: 'lun', diaCorte: 'vie', diasLaborables: 5 };

  const diaInicio = h('select', { onChange: refreshPreview }, DIAS.map(d => h('option', { value: d, selected: cal.diaInicio === d }, nombreDia(d))));
  const diaCorte = h('select', { onChange: refreshPreview }, DIAS.map(d => h('option', { value: d, selected: cal.diaCorte === d }, nombreDia(d))));
  const diasLaborables = h('input', { type: 'number', step: '1', min: '1', max: '7', value: cal.diasLaborables ?? 5, onInput: refreshPreview });

  const preview = h('div', { class: 'muted', style: { fontSize: '13px' } }, '');
  function refreshPreview() {
    const c = { diaInicio: diaInicio.value, diaCorte: diaCorte.value, diasLaborables: Number(diasLaborables.value) || 5 };
    const per = periodoSemanal(new Date(), c);
    preview.textContent = `Período operativo actual: ${per.label} (corte ${nombreDia(c.diaCorte)}, ${c.diasLaborables} días laborables).`;
  }
  refreshPreview();

  const guardarBtn = h('button', { class: 'btn primary', onClick: guardar }, 'Guardar');
  async function guardar() {
    const c = {
      diaInicio: diaInicio.value,
      diaCorte: diaCorte.value,
      diasLaborables: Number(diasLaborables.value) || 5
    };
    guardarBtn.disabled = true;
    try {
      await updateMeta({ calendarioSemanal: c });
      toast('Calendario actualizado', 'ok');
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
    guardarBtn.disabled = false;
  }

  renderShell(crumbs, h('div', {}, [
    h('h1', {}, 'Configuración'),
    h('div', { class: 'card' }, [
      h('h3', {}, 'Calendario semanal (nómina de operativos)'),
      h('p', { class: 'muted', style: { fontSize: '12px', margin: '0 0 14px' } },
        'Define cómo se calcula el período semanal de los operativos. El resto del personal es quincenal (1-15 / 16-fin de mes) y no es configurable.'),
      h('div', { class: 'grid-3' }, [
        h('div', { class: 'field' }, [h('label', {}, 'Día de inicio'), diaInicio]),
        h('div', { class: 'field' }, [h('label', {}, 'Día de corte'), diaCorte]),
        h('div', { class: 'field' }, [h('label', {}, 'Días laborables'), diasLaborables])
      ]),
      h('div', { style: { marginTop: '14px', padding: '10px 12px', background: 'var(--bg-2)', borderRadius: '6px' } }, preview),
      h('div', { class: 'row', style: { marginTop: '16px', justifyContent: 'flex-end' } }, [guardarBtn])
    ])
  ]));
}
