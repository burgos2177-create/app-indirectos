import { h, toast, modal } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import {
  getEscenario, updateEscenarioMeta, setEscenarioEmpleado, removeEscenarioEmpleado,
  removeEscenario, listEmpleados
} from '../services/db.js';
import { navigate } from '../state/router.js';
import { money, num0, num2, tipoPersonalLabel, periodicidadDeTipo, uid as randId } from '../util/format.js';

const TIPOS = ['operativo', 'tecnico_campo', 'tecnico_oficina', 'directivo'];

// Constantes de proyección anual.
// Operativo: 52 semanas/año (asumimos pago todas las semanas).
// Quincenal: 24 quincenas/año.
const SEMANAS_AL_ANO = 52;
const QUINCENAS_AL_ANO = 24;

// Calcula proyección agregada. Reutilizable desde la lista de escenarios.
// Cada empleado tiene { tipo, sueldoBase, bonosEstimados? }.
export function calcularProyeccion(empleados, factorPatronal = 1.35) {
  let brutoSemanal = 0, brutoQuincenal = 0;
  const porTipo = {};
  const counts = {};
  for (const t of TIPOS) { porTipo[t] = 0; counts[t] = 0; }

  for (const e of empleados) {
    const bruto = (Number(e.sueldoBase) || 0) + (Number(e.bonosEstimados) || 0);
    if (e.tipo === 'operativo') brutoSemanal += bruto;
    else brutoQuincenal += bruto;
    if (porTipo[e.tipo] != null) {
      porTipo[e.tipo] += bruto;
      counts[e.tipo] += 1;
    }
  }

  const brutoAnual = brutoSemanal * SEMANAS_AL_ANO + brutoQuincenal * QUINCENAS_AL_ANO;
  const brutoMensual = brutoAnual / 12;
  const factor = Number(factorPatronal) || 1.35;
  const costoTotalAnual = brutoAnual * factor;
  const costoTotalMensual = brutoMensual * factor;

  return {
    brutoSemanal, brutoQuincenal,
    brutoMensual, brutoAnual,
    costoTotalMensual, costoTotalAnual,
    porTipo, counts,
    factorPatronal: factor
  };
}

export async function renderEscenarioEditor({ params }) {
  const escenarioId = params.id;
  const crumbs = [
    { label: 'Inicio', to: '/' },
    { label: 'Proyección', to: '/proyeccion' },
    { label: 'Escenario' }
  ];
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando…'));

  let escenario, empleadosCatalogo;
  try {
    [escenario, empleadosCatalogo] = await Promise.all([
      getEscenario(escenarioId),
      listEmpleados()
    ]);
  } catch (err) {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message));
    return;
  }
  if (!escenario) {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Escenario no encontrado.'));
    return;
  }

  const meta = escenario.meta || {};
  const empleadosObj = escenario.empleados || {};
  const empleadosArr = Object.entries(empleadosObj).map(([rowId, e]) => ({ rowId, ...e }));

  // === Header con nombre editable + factor patronal ===
  const nombreEl = h('h1', { contentEditable: 'true', class: 'editable-title' }, meta.nombre || 'Sin nombre');
  nombreEl.addEventListener('blur', async () => {
    const nuevo = nombreEl.textContent.trim() || 'Sin nombre';
    if (nuevo !== meta.nombre) await updateEscenarioMeta(escenarioId, { nombre: nuevo });
  });
  nombreEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nombreEl.blur(); }
  });

  const factorInput = h('input', {
    type: 'number', step: '0.01', min: '1',
    value: meta.factorPatronal ?? 1.35,
    style: { width: '90px' },
    onChange: async () => {
      const v = Number(factorInput.value) || 1.35;
      await updateEscenarioMeta(escenarioId, { factorPatronal: v });
      refreshKpis();
    }
  });

  // === Filtro por tipo en la tabla ===
  let filtroTipo = '';
  const chips = h('div', { class: 'chips-row', style: { marginBottom: '12px' } }, []);
  const renderChips = () => {
    chips.innerHTML = '';
    const counts = TIPOS.reduce((acc, t) => { acc[t] = empleadosArr.filter(e => e.tipo === t).length; return acc; }, {});
    chips.appendChild(chip('Todos', !filtroTipo, empleadosArr.length, () => { filtroTipo = ''; redrawTable(); }));
    for (const t of TIPOS) {
      chips.appendChild(chip(tipoPersonalLabel[t], filtroTipo === t, counts[t], () => { filtroTipo = t; redrawTable(); }));
    }
  };
  renderChips();

  // === KPIs ===
  const kpiRow = h('div', { class: 'kpi-row' }, []);
  const tipoBreakdown = h('div', { class: 'tipo-breakdown' }, []);

  function refreshKpis() {
    const factor = Number(factorInput.value) || 1.35;
    const proy = calcularProyeccion(empleadosArr, factor);
    kpiRow.innerHTML = '';
    kpiRow.appendChild(kpi('Plantilla', `${num0(empleadosArr.length)} personas`));
    kpiRow.appendChild(kpi('Nómina semanal (operativos)', money(proy.brutoSemanal)));
    kpiRow.appendChild(kpi('Nómina quincenal (resto)', money(proy.brutoQuincenal)));
    kpiRow.appendChild(kpi('Mensual bruto', money(proy.brutoMensual), 'highlight'));
    kpiRow.appendChild(kpi('Anual bruto', money(proy.brutoAnual)));
    kpiRow.appendChild(kpi('Costo total mensual', money(proy.costoTotalMensual), 'accent'));
    kpiRow.appendChild(kpi('Costo total anual', money(proy.costoTotalAnual), 'accent'));

    tipoBreakdown.innerHTML = '';
    for (const t of TIPOS) {
      const totalTipo = proy.porTipo[t] || 0;
      const count = proy.counts[t] || 0;
      const periodicidad = periodicidadDeTipo(t);
      const mensualTipo = periodicidad === 'semanal'
        ? (totalTipo * SEMANAS_AL_ANO) / 12
        : (totalTipo * QUINCENAS_AL_ANO) / 12;
      tipoBreakdown.appendChild(h('div', { class: 'tipo-row' }, [
        h('div', { class: 'tipo-name' }, [
          h('span', { class: 'tag' }, tipoPersonalLabel[t]),
          h('span', { class: 'muted', style: { fontSize: '11px', marginLeft: '6px' } },
            `${count} pers · ${periodicidad}`)
        ]),
        h('div', { class: 'tipo-val' }, [
          h('span', { class: 'muted', style: { fontSize: '11px' } }, periodicidad === 'semanal' ? 'Semanal: ' : 'Quincenal: '),
          h('b', {}, money(totalTipo))
        ]),
        h('div', { class: 'tipo-val' }, [
          h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Mensual: '),
          h('b', {}, money(mensualTipo))
        ])
      ]));
    }
  }

  // === Tabla de empleados del escenario ===
  const tableContainer = h('div', {});
  function redrawTable() {
    tableContainer.innerHTML = '';
    const filtrados = filtroTipo ? empleadosArr.filter(e => e.tipo === filtroTipo) : empleadosArr;
    if (filtrados.length === 0) {
      tableContainer.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'ico' }, '👥'),
        h('div', {}, empleadosArr.length === 0
          ? 'Plantilla vacía. Importa empleados del catálogo o agrega hipotéticos para empezar.'
          : 'No hay empleados de ese tipo en este escenario.')
      ]));
      return;
    }
    tableContainer.appendChild(escenarioTable(filtrados));
    renderChips();
  }

  function escenarioTable(rows) {
    const tbody = h('tbody', {}, rows.map(rowEl));
    return h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
      h('table', { class: 'tbl' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', {}, 'Nombre'),
          h('th', {}, 'Tipo'),
          h('th', {}, 'Periodicidad'),
          h('th', { class: 'num' }, 'Sueldo base'),
          h('th', { class: 'num' }, 'Bonos est.'),
          h('th', { class: 'num' }, 'Bruto / período'),
          h('th', { class: 'num' }, 'Mensual'),
          h('th', {}, '')
        ])]),
        tbody
      ])
    ]);
  }

  function rowEl(e) {
    const periodicidad = periodicidadDeTipo(e.tipo);
    const bruto = (Number(e.sueldoBase) || 0) + (Number(e.bonosEstimados) || 0);
    const mensual = periodicidad === 'semanal'
      ? (bruto * SEMANAS_AL_ANO) / 12
      : (bruto * QUINCENAS_AL_ANO) / 12;
    return h('tr', {}, [
      h('td', {}, [
        h('b', {}, e.nombre || '(sin nombre)'),
        e.sourceEmpleadoId
          ? h('div', { class: 'muted', style: { fontSize: '10px' } }, 'Del catálogo')
          : h('div', { class: 'muted', style: { fontSize: '10px' } }, 'Hipotético')
      ]),
      h('td', {}, h('span', { class: 'tag' }, tipoPersonalLabel[e.tipo] || e.tipo)),
      h('td', { class: 'muted' }, periodicidad === 'semanal' ? 'Semanal' : 'Quincenal'),
      h('td', { class: 'num' }, money(e.sueldoBase || 0)),
      h('td', { class: 'num muted' }, money(e.bonosEstimados || 0)),
      h('td', { class: 'num' }, h('b', {}, money(bruto))),
      h('td', { class: 'num accent' }, money(mensual)),
      h('td', {}, h('div', { class: 'row' }, [
        h('button', { class: 'btn sm ghost', onClick: () => editarRowDialog(e) }, 'Editar'),
        h('button', { class: 'btn sm ghost danger', onClick: () => quitarRow(e.rowId) }, '✕')
      ]))
    ]);
  }

  // === Mutaciones ===
  async function agregarDelCatalogoDialog() {
    const catList = Object.entries(empleadosCatalogo || {})
      .map(([id, e]) => ({ id, ...e }))
      .filter(e => e.activo !== false);
    if (catList.length === 0) {
      toast('No hay empleados en el catálogo. Crea uno desde la vista Empleados.', 'warn');
      return;
    }
    const yaEnEsc = new Set(empleadosArr.map(e => e.sourceEmpleadoId).filter(Boolean));
    const checks = {};
    const filas = catList.map(e => {
      const yaIncluido = yaEnEsc.has(e.id);
      checks[e.id] = h('input', { type: 'checkbox', disabled: yaIncluido });
      return h('label', { class: 'row', style: { padding: '6px 4px', cursor: yaIncluido ? 'default' : 'pointer' } }, [
        checks[e.id],
        h('div', { style: { flex: 1, opacity: yaIncluido ? 0.5 : 1 } }, [
          h('b', {}, e.nombre || '(sin nombre)'),
          h('span', { class: 'muted', style: { marginLeft: '6px', fontSize: '11px' } },
            `${tipoPersonalLabel[e.tipo]} · ${money(e.sueldoBase || 0)}${yaIncluido ? ' · ya incluido' : ''}`)
        ])
      ]);
    });

    await modal({
      title: 'Agregar del catálogo',
      size: 'lg',
      body: h('div', { style: { maxHeight: '60vh', overflow: 'auto' } }, filas),
      confirmLabel: 'Agregar seleccionados',
      onConfirm: async () => {
        const sel = catList.filter(e => checks[e.id].checked && !checks[e.id].disabled);
        if (sel.length === 0) { toast('Selecciona al menos uno', 'warn'); return false; }
        try {
          for (const e of sel) {
            const rowId = randId();
            const data = {
              nombre: e.nombre,
              tipo: e.tipo,
              sueldoBase: Number(e.sueldoBase) || 0,
              bonosEstimados: 0,
              deduccionesEstimadas: e.ultimasDeducciones || {},
              sourceEmpleadoId: e.id
            };
            await setEscenarioEmpleado(escenarioId, rowId, data);
            empleadosArr.push({ rowId, ...data });
          }
          toast(`${sel.length} agregado(s)`, 'ok');
          redrawTable(); refreshKpis();
          return true;
        } catch (err) { toast('Error: ' + err.message, 'danger'); return false; }
      }
    });
  }

  async function agregarHipoteticoDialog() {
    await empleadoHipoteticoDialog(null);
  }

  async function editarRowDialog(row) {
    await empleadoHipoteticoDialog(row);
  }

  async function empleadoHipoteticoDialog(row) {
    const isEdit = !!row;
    const nombre = h('input', { value: row?.nombre || '', placeholder: 'Nombre o etiqueta' });
    const tipo = h('select', {}, TIPOS.map(t =>
      h('option', { value: t, selected: (row?.tipo || 'operativo') === t }, tipoPersonalLabel[t])
    ));
    const sueldoBase = h('input', { type: 'number', step: '0.01', min: '0', value: row?.sueldoBase || 0 });
    const bonos = h('input', { type: 'number', step: '0.01', min: '0', value: row?.bonosEstimados || 0 });
    const periodicidadHint = h('span', { class: 'muted', style: { fontSize: '11px' } }, '');
    const updateHint = () => {
      periodicidadHint.textContent = periodicidadDeTipo(tipo.value) === 'semanal'
        ? 'Operativo → sueldo por semana'
        : 'Quincenal → sueldo por quincena';
    };
    tipo.addEventListener('change', updateHint);
    updateHint();

    await modal({
      title: isEdit ? `Editar: ${row.nombre || 'empleado'}` : 'Nuevo empleado hipotético',
      body: h('div', {}, [
        h('div', { class: 'grid-2' }, [
          h('div', { class: 'field' }, [h('label', {}, 'Nombre'), nombre]),
          h('div', { class: 'field' }, [
            h('label', {}, ['Tipo  ', periodicidadHint]),
            tipo
          ])
        ]),
        h('div', { class: 'grid-2', style: { marginTop: '10px' } }, [
          h('div', { class: 'field' }, [h('label', {}, 'Sueldo base por período'), sueldoBase]),
          h('div', { class: 'field' }, [h('label', {}, 'Bonos estimados por período'), bonos])
        ]),
        isEdit && row.sourceEmpleadoId
          ? h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '8px' } },
              'Editar aquí solo afecta este escenario, no al empleado del catálogo.')
          : null
      ]),
      confirmLabel: isEdit ? 'Guardar' : 'Agregar',
      onConfirm: async () => {
        if (!nombre.value.trim()) { toast('Nombre obligatorio', 'warn'); return false; }
        const data = {
          nombre: nombre.value.trim(),
          tipo: tipo.value,
          sueldoBase: Number(sueldoBase.value) || 0,
          bonosEstimados: Number(bonos.value) || 0,
          sourceEmpleadoId: row?.sourceEmpleadoId || null
        };
        try {
          if (isEdit) {
            await setEscenarioEmpleado(escenarioId, row.rowId, { ...row, ...data, rowId: undefined });
            const idx = empleadosArr.findIndex(e => e.rowId === row.rowId);
            if (idx >= 0) empleadosArr[idx] = { ...empleadosArr[idx], ...data };
          } else {
            const rowId = randId();
            await setEscenarioEmpleado(escenarioId, rowId, data);
            empleadosArr.push({ rowId, ...data });
          }
          redrawTable(); refreshKpis();
          return true;
        } catch (err) { toast('Error: ' + err.message, 'danger'); return false; }
      }
    });
  }

  async function quitarRow(rowId) {
    try {
      await removeEscenarioEmpleado(escenarioId, rowId);
      const idx = empleadosArr.findIndex(e => e.rowId === rowId);
      if (idx >= 0) empleadosArr.splice(idx, 1);
      redrawTable(); refreshKpis();
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  }

  async function borrarEscenario() {
    const ok = await modal({
      title: 'Eliminar escenario',
      body: `¿Eliminar "${meta.nombre || 'sin nombre'}"? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar', danger: true
    });
    if (!ok) return;
    try {
      await removeEscenario(escenarioId);
      toast('Escenario eliminado', 'ok');
      navigate('/proyeccion');
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  }

  // === Render ===
  const header = h('div', {}, [
    h('div', { class: 'row' }, [
      nombreEl,
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn ghost', onClick: borrarEscenario }, '🗑 Eliminar escenario')
    ]),
    meta.descripcion ? h('p', { class: 'muted' }, meta.descripcion) : null,
    h('div', { class: 'row', style: { marginTop: '10px' } }, [
      h('span', { class: 'muted' }, 'Factor patronal:'),
      factorInput,
      h('span', { class: 'muted', style: { fontSize: '11px' } },
        '(multiplica el bruto para estimar el costo total con cuotas patronales)')
    ])
  ]);

  const actions = h('div', { class: 'row', style: { margin: '14px 0' } }, [
    h('button', { class: 'btn primary', onClick: agregarDelCatalogoDialog }, '+ Importar del catálogo'),
    h('button', { class: 'btn', onClick: agregarHipoteticoDialog }, '+ Empleado hipotético')
  ]);

  refreshKpis();
  redrawTable();

  renderShell(crumbs, h('div', {}, [
    header,
    h('div', { class: 'card', style: { marginTop: '14px' } }, [
      h('h3', {}, 'Resumen'),
      kpiRow,
      h('div', { style: { marginTop: '14px' } }, [
        h('h4', { style: { margin: '0 0 8px', fontSize: '12px', color: 'var(--text-1)', textTransform: 'uppercase', letterSpacing: '.5px' } },
          'Por tipo de personal'),
        tipoBreakdown
      ])
    ]),
    actions,
    chips,
    tableContainer
  ]));
}

function kpi(label, value, cls = '') {
  return h('div', { class: 'kpi ' + cls }, [
    h('span', { class: 'kpi-label' }, label),
    h('span', { class: 'kpi-value' }, value)
  ]);
}

function chip(label, active, count, onClick) {
  return h('button', { class: 'chip' + (active ? ' active' : ''), onClick }, [
    h('span', {}, label),
    h('span', { class: 'chip-count' }, String(count))
  ]);
}
