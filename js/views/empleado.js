import { h, toast, modal } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import {
  getEmpleado, createEmpleado, updateEmpleado, removeEmpleado,
  listObrasLegacy
} from '../services/db.js';
import { navigate } from '../state/router.js';
import { money, num2, tipoPersonalLabel, periodicidadDeTipo } from '../util/format.js';

const TIPOS = ['operativo', 'tecnico_campo', 'tecnico_oficina', 'directivo'];

export async function renderEmpleadoEditor({ params }) {
  const isNuevo = params.id === 'nuevo';
  const crumbs = [
    { label: 'Inicio', to: '/' },
    { label: 'Empleados', to: '/empleados' },
    { label: isNuevo ? 'Nuevo' : 'Detalle' }
  ];

  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando…'));

  let empleado, obras;
  try {
    [empleado, obras] = await Promise.all([
      isNuevo ? Promise.resolve(emptyEmpleado()) : getEmpleado(params.id),
      listObrasLegacy()
    ]);
  } catch (err) {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message));
    return;
  }
  if (!empleado) {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Empleado no encontrado.'));
    return;
  }

  // Working draft — mutaciones in-place hasta que se guarde.
  const draft = JSON.parse(JSON.stringify(empleado));
  if (!draft.obrasAsignadas) draft.obrasAsignadas = {};
  if (!draft.ultimasDeducciones) draft.ultimasDeducciones = { isr: 0, imss: 0, infonavit: 0, prestamos: 0 };

  // === Refs vivas a inputs y previsualizaciones ===
  const refs = {};
  const pesosUI = {};   // obraId → { row, input, peso }

  refs.nombre = h('input', { value: draft.nombre || '', placeholder: 'Nombre completo' });
  refs.rfc = h('input', { value: draft.rfc || '', placeholder: 'RFC (opcional)' });
  refs.curp = h('input', { value: draft.curp || '', placeholder: 'CURP (opcional)' });
  refs.nss = h('input', { value: draft.nss || '', placeholder: 'NSS (opcional)' });
  refs.tipo = h('select', {
    onChange: () => {
      draft.tipo = refs.tipo.value;
      refs.periodicidadLabel.textContent = periodicidadDeTipo(draft.tipo) === 'semanal' ? 'Semanal' : 'Quincenal';
    }
  }, TIPOS.map(t => h('option', { value: t, selected: draft.tipo === t }, tipoPersonalLabel[t])));
  if (!draft.tipo) draft.tipo = refs.tipo.value;
  refs.periodicidadLabel = h('span', { class: 'tag' },
    periodicidadDeTipo(draft.tipo) === 'semanal' ? 'Semanal' : 'Quincenal');
  refs.sueldoBase = h('input', {
    type: 'number', step: '0.01', min: '0',
    value: draft.sueldoBase || 0, placeholder: '0.00'
  });
  refs.notas = h('textarea', { rows: 3, placeholder: 'Notas internas (opcional)' }, draft.notas || '');

  // === Sección obras asignadas con pesos ===
  const obrasIds = Object.keys(obras || {});
  const obrasContainer = h('div', { class: 'pesos-grid' }, obrasIds.map(oid => {
    const meta = obras[oid].meta || {};
    const peso = draft.obrasAsignadas[oid]?.peso || 0;
    const checked = !!draft.obrasAsignadas[oid];

    const cb = h('input', { type: 'checkbox', checked, onChange: () => {
      if (cb.checked) {
        draft.obrasAsignadas[oid] = { peso: 0 };
        pesoInput.disabled = false;
        pesoInput.value = '0';
      } else {
        delete draft.obrasAsignadas[oid];
        pesoInput.disabled = true;
        pesoInput.value = '0';
      }
      refreshSuma();
    } });
    const pesoInput = h('input', {
      type: 'number', step: '0.01', min: '0', max: '100',
      value: peso, disabled: !checked, style: { width: '80px' },
      onInput: () => {
        const v = Number(pesoInput.value) || 0;
        if (draft.obrasAsignadas[oid]) draft.obrasAsignadas[oid].peso = v;
        refreshSuma();
      }
    });
    pesosUI[oid] = { input: pesoInput, cb };

    return h('label', { class: 'peso-row' }, [
      cb,
      h('div', { class: 'peso-info' }, [
        h('div', { class: 'peso-nombre' }, meta.nombre || oid.slice(0, 6)),
        h('div', { class: 'peso-meta muted' }, [
          meta.contratoNo ? `Contrato ${meta.contratoNo}` : '',
          meta.cliente ? ` · ${meta.cliente}` : ''
        ].filter(Boolean).join('') || '—')
      ]),
      h('div', { class: 'peso-input-wrap' }, [
        pesoInput,
        h('span', { class: 'muted' }, '%')
      ])
    ]);
  }));

  const sumaBadge = h('span', { class: 'tag' }, 'Σ 0%');
  const sumaWrap = h('div', { class: 'row', style: { marginTop: '10px' } }, [
    h('div', {}, 'Suma de pesos: '),
    sumaBadge,
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'btn ghost sm', onClick: distribuirParejo }, 'Distribuir parejo'),
    h('button', { class: 'btn ghost sm', onClick: limpiarObras }, 'Limpiar')
  ]);

  function refreshSuma() {
    const ids = Object.keys(draft.obrasAsignadas);
    const suma = ids.reduce((s, id) => s + (Number(draft.obrasAsignadas[id]?.peso) || 0), 0);
    sumaBadge.textContent = `Σ ${num2(suma)}%`;
    sumaBadge.className = 'tag ' +
      (ids.length === 0 ? '' : Math.abs(suma - 100) < 0.01 ? 'ok' : 'warn');
  }
  function distribuirParejo() {
    const ids = Object.keys(draft.obrasAsignadas);
    if (ids.length === 0) {
      toast('Primero marca al menos una obra.', 'warn');
      return;
    }
    const peso = Math.round((100 / ids.length) * 100) / 100;
    let resto = 100 - peso * ids.length;
    ids.forEach((id, i) => {
      const p = i === 0 ? Math.round((peso + resto) * 100) / 100 : peso;
      draft.obrasAsignadas[id].peso = p;
      pesosUI[id].input.value = String(p);
    });
    refreshSuma();
  }
  function limpiarObras() {
    for (const id of Object.keys(draft.obrasAsignadas)) {
      pesosUI[id].cb.checked = false;
      pesosUI[id].input.disabled = true;
      pesosUI[id].input.value = '0';
      delete draft.obrasAsignadas[id];
    }
    refreshSuma();
  }
  refreshSuma();

  // === Deducciones (prefill / overrides) ===
  refs.isr = numInput(draft.ultimasDeducciones.isr || 0);
  refs.imss = numInput(draft.ultimasDeducciones.imss || 0);
  refs.infonavit = numInput(draft.ultimasDeducciones.infonavit || 0);
  refs.prestamos = numInput(draft.ultimasDeducciones.prestamos || 0);

  // === Acciones ===
  const guardarBtn = h('button', { class: 'btn primary', onClick: guardar }, 'Guardar');
  const eliminarBtn = h('button', {
    class: 'btn danger', onClick: () => eliminar()
  }, 'Eliminar');
  const bajaBtn = h('button', {
    class: 'btn ghost',
    onClick: () => toggleActivo()
  }, draft.activo === false ? 'Reactivar' : 'Dar de baja');

  async function guardar() {
    const nombre = refs.nombre.value.trim();
    if (!nombre) { toast('Nombre obligatorio', 'warn'); refs.nombre.focus(); return; }
    const sueldoBase = Number(refs.sueldoBase.value) || 0;
    if (sueldoBase < 0) { toast('Sueldo base inválido', 'warn'); return; }

    const ids = Object.keys(draft.obrasAsignadas);
    if (ids.length > 0) {
      const suma = ids.reduce((s, id) => s + (Number(draft.obrasAsignadas[id]?.peso) || 0), 0);
      if (Math.abs(suma - 100) > 0.01) {
        toast(`La suma de pesos de obras debe ser 100% (actual: ${num2(suma)}%)`, 'warn');
        return;
      }
    }

    const data = {
      nombre,
      rfc: refs.rfc.value.trim() || null,
      curp: refs.curp.value.trim() || null,
      nss: refs.nss.value.trim() || null,
      tipo: refs.tipo.value,
      sueldoBase,
      obrasAsignadas: ids.length === 0 ? null : draft.obrasAsignadas,
      ultimasDeducciones: {
        isr: Number(refs.isr.value) || 0,
        imss: Number(refs.imss.value) || 0,
        infonavit: Number(refs.infonavit.value) || 0,
        prestamos: Number(refs.prestamos.value) || 0
      },
      notas: refs.notas.value.trim() || null,
      activo: draft.activo !== false
    };
    if (isNuevo) data.fechaAlta = data.fechaAlta || Date.now();

    guardarBtn.disabled = true; guardarBtn.innerHTML = '<span class="spinner"></span> Guardando…';
    try {
      if (isNuevo) {
        const newId = await createEmpleado(data);
        toast('Empleado creado', 'ok');
        navigate('/empleados/' + newId);
      } else {
        await updateEmpleado(params.id, data);
        toast('Cambios guardados', 'ok');
        renderEmpleadoEditor({ params });
      }
    } catch (err) {
      toast('Error: ' + err.message, 'danger');
      guardarBtn.disabled = false; guardarBtn.textContent = 'Guardar';
    }
  }

  async function toggleActivo() {
    if (isNuevo) return;
    const nuevoActivo = draft.activo === false;
    const fecha = nuevoActivo ? null : Date.now();
    await updateEmpleado(params.id, {
      activo: nuevoActivo,
      fechaBaja: nuevoActivo ? null : fecha
    });
    toast(nuevoActivo ? 'Empleado reactivado' : 'Empleado dado de baja', 'ok');
    renderEmpleadoEditor({ params });
  }

  async function eliminar() {
    if (isNuevo) { navigate('/empleados'); return; }
    const ok = await modal({
      title: 'Eliminar empleado',
      body: h('div', {}, [
        h('p', {}, `¿Eliminar permanentemente a ${draft.nombre || 'este empleado'}?`),
        h('p', { class: 'muted', style: { fontSize: '12px' } },
          'Esta acción no se puede deshacer. Si solo quieres marcar al empleado como inactivo, usa "Dar de baja" en su lugar — preserva el histórico.')
      ]),
      confirmLabel: 'Eliminar', danger: true
    });
    if (!ok) return;
    try {
      await removeEmpleado(params.id);
      toast('Empleado eliminado', 'ok');
      navigate('/empleados');
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  }

  // === Render ===
  const form = h('div', {}, [
    h('div', { class: 'card' }, [
      h('h3', {}, 'Datos generales'),
      h('div', { class: 'grid-2' }, [
        h('div', { class: 'field' }, [h('label', {}, 'Nombre *'), refs.nombre]),
        h('div', { class: 'field' }, [
          h('label', {}, ['Tipo *  ', refs.periodicidadLabel]),
          refs.tipo
        ])
      ]),
      h('div', { class: 'grid-3', style: { marginTop: '10px' } }, [
        h('div', { class: 'field' }, [h('label', {}, 'RFC'), refs.rfc]),
        h('div', { class: 'field' }, [h('label', {}, 'CURP'), refs.curp]),
        h('div', { class: 'field' }, [h('label', {}, 'NSS'), refs.nss])
      ]),
      h('div', { class: 'grid-2', style: { marginTop: '10px' } }, [
        h('div', { class: 'field' }, [
          h('label', {}, `Sueldo base (${periodicidadDeTipo(draft.tipo) === 'semanal' ? 'por semana' : 'por quincena'})`),
          refs.sueldoBase
        ]),
        h('div', { class: 'field' }, [h('label', {}, 'Notas internas'), refs.notas])
      ])
    ]),

    h('div', { class: 'card' }, [
      h('h3', {}, 'Obras asignadas y prorrateo'),
      h('p', { class: 'muted', style: { fontSize: '12px', margin: '0 0 10px' } },
        'Marca las obras donde participa este empleado y asigna el peso (%) con que se prorratea su sueldo a cada una. Total = 100%.'),
      obrasIds.length === 0
        ? h('div', { class: 'muted' }, 'No hay obras creadas todavía. Las obras se crean en la app de estimaciones.')
        : obrasContainer,
      obrasIds.length > 0 && sumaWrap
    ]),

    h('div', { class: 'card' }, [
      h('h3', {}, 'Deducciones (prefill para próxima nómina)'),
      h('p', { class: 'muted', style: { fontSize: '12px', margin: '0 0 10px' } },
        'Valores manuales que se precargan al armar la próxima nómina. Se actualizan automáticamente con lo que captures en cada período. El auto-cálculo SAT (ISR/IMSS/INFONAVIT con tablas) es para v2.'),
      h('div', { class: 'grid-4' }, [
        h('div', { class: 'field' }, [h('label', {}, 'ISR'), refs.isr]),
        h('div', { class: 'field' }, [h('label', {}, 'IMSS'), refs.imss]),
        h('div', { class: 'field' }, [h('label', {}, 'INFONAVIT'), refs.infonavit]),
        h('div', { class: 'field' }, [h('label', {}, 'Préstamos / otros'), refs.prestamos])
      ])
    ]),

    h('div', { class: 'row', style: { marginTop: '14px', justifyContent: 'flex-end' } }, [
      !isNuevo && eliminarBtn,
      !isNuevo && bajaBtn,
      h('button', { class: 'btn ghost', onClick: () => navigate('/empleados') }, 'Cancelar'),
      guardarBtn
    ])
  ]);

  renderShell(crumbs, h('div', {}, [
    h('h1', {}, isNuevo ? 'Nuevo empleado' : (draft.nombre || 'Empleado')),
    form
  ]));
}

function emptyEmpleado() {
  return {
    nombre: '',
    tipo: 'operativo',
    sueldoBase: 0,
    obrasAsignadas: {},
    ultimasDeducciones: { isr: 0, imss: 0, infonavit: 0, prestamos: 0 },
    activo: true,
    fechaAlta: Date.now()
  };
}

function numInput(value) {
  return h('input', { type: 'number', step: '0.01', min: '0', value });
}
