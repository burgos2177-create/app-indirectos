import { h, toast, modal } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import {
  listPuestos, upsertPuesto, removePuesto, listEmpleados
} from '../services/db.js';
import { money, slug, tipoPersonalLabel, periodicidadDeTipo } from '../util/format.js';

const TIPOS = ['operativo', 'tecnico_campo', 'tecnico_oficina', 'directivo'];

// Equivalente mensual del pago por período (semanal ×52/12, quincenal ×2).
const mensualDe = (tipo, monto) => periodicidadDeTipo(tipo) === 'semanal' ? monto * 52 / 12 : monto * 2;

// Lista ordenada de presets a partir del objeto crudo de la BD.
export function puestosOrdenados(raw) {
  return Object.entries(raw || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0) ||
      String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
}

// Los 4 campos que un preset copia a la ficha del empleado.
export function camposPreset(p) {
  return {
    tipo: p?.tipo || 'operativo',
    sueldoBase: Number(p?.sueldoBase) || 0,
    bonos: Number(p?.bonos) || 0,
    sdi: Number(p?.sdi) || 0
  };
}

// Diálogo compartido: lo usa esta vista (alta/edición del catálogo) y la ficha
// del empleado (opción "+ Nuevo puesto…"). Resuelve a
// { id, nombre, tipo, sueldoBase, bonos, sdi, guardado } o false si se cancela.
//
//   puesto        → preset existente a editar (null = alta)
//   usadosIds     → Set de ids ya ocupados, para no colisionar al generar el id
//   iniciales     → valores con que precargar el formulario (los de la ficha)
//   preguntarGuardar → muestra el check "Guardar como preset" (ficha empleado)
export async function puestoDialog({ puesto = null, usadosIds = new Set(), orden = 1, iniciales = null, preguntarGuardar = false } = {}) {
  const isEdit = !!puesto;
  const base = puesto || iniciales || {};

  const nombre = h('input', { value: base.nombre || '', placeholder: 'Ej. Oficial albañil, Residente de obra' });
  const tipo = h('select', {
    onChange: () => { sueldoLabel.textContent = sueldoLabelText(); refreshHint(); }
  }, TIPOS.map(t => h('option', { value: t, selected: (base.tipo || 'operativo') === t }, tipoPersonalLabel[t])));
  const sueldoBase = h('input', {
    type: 'number', step: '0.01', min: '0', value: Number(base.sueldoBase) || 0, onInput: refreshHint
  });
  const bonos = h('input', {
    type: 'number', step: '0.01', min: '0', value: Number(base.bonos) || 0, onInput: refreshHint
  });
  const sdi = h('input', { type: 'number', step: '0.01', min: '0', value: Number(base.sdi) || 0 });
  const activaInput = h('input', { type: 'checkbox', checked: puesto ? puesto.activo !== false : true });
  const guardarPreset = h('input', { type: 'checkbox', checked: true });

  const sueldoLabelText = () => `Sueldo base (${periodicidadDeTipo(tipo.value) === 'semanal' ? 'por semana' : 'por quincena'})`;
  const sueldoLabel = h('label', {}, sueldoLabelText());
  const hint = h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, '');
  function refreshHint() {
    const total = (Number(sueldoBase.value) || 0) + (Number(bonos.value) || 0);
    hint.innerHTML = `Total por período: <b style="color:var(--accent)">${money(total)}</b> · ≈ ${money(mensualDe(tipo.value, total))} / mes`;
  }
  refreshHint();

  return await modal({
    title: isEdit ? 'Editar puesto' : 'Nuevo puesto',
    body: h('div', {}, [
      h('div', { class: 'grid-2' }, [
        h('div', { class: 'field' }, [h('label', {}, 'Nombre del puesto *'), nombre]),
        h('div', { class: 'field' }, [h('label', {}, 'Tipo de personal'), tipo])
      ]),
      h('div', { class: 'grid-3', style: { marginTop: '10px' } }, [
        h('div', { class: 'field' }, [sueldoLabel, sueldoBase]),
        h('div', { class: 'field' }, [h('label', {}, 'Bono por rendimiento'), bonos]),
        h('div', { class: 'field' }, [h('label', {}, 'SDI (IMSS)'), sdi])
      ]),
      hint,
      isEdit ? h('label', { class: 'row', style: { gap: '8px', alignItems: 'center', marginTop: '12px' } }, [
        activaInput, h('span', {}, 'Activo (aparece en el selector de la ficha)')
      ]) : null,
      preguntarGuardar ? h('div', { style: { marginTop: '12px', borderTop: '1px solid var(--line)', paddingTop: '10px' } }, [
        h('label', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, [
          guardarPreset, h('span', {}, 'Guardar como preset para futuras altas')
        ]),
        h('span', { class: 'muted', style: { fontSize: '11px' } },
          'Si lo dejas sin marcar, el puesto se escribe solo en este empleado y no queda en el catálogo.')
      ]) : null,
      isEdit ? h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '8px' } },
        `ID: ${puesto.id} · Editar el preset NO cambia a los empleados ya dados de alta.`) : null
    ]),
    size: 'lg',
    confirmLabel: isEdit ? 'Guardar' : 'Crear',
    onConfirm: async () => {
      const nom = nombre.value.trim();
      if (!nom) { toast('El nombre del puesto es obligatorio', 'warn'); return false; }

      const valores = {
        nombre: nom,
        tipo: tipo.value,
        sueldoBase: Number(sueldoBase.value) || 0,
        bonos: Number(bonos.value) || 0,
        sdi: Number(sdi.value) || 0
      };
      const debeGuardar = preguntarGuardar ? guardarPreset.checked : true;
      if (!debeGuardar) return { id: null, ...valores, guardado: false };

      let id = isEdit ? puesto.id : slug(nom, 'puesto');
      if (!isEdit && usadosIds.has(id)) {
        let i = 2;
        while (usadosIds.has(`${id}_${i}`)) i++;
        id = `${id}_${i}`;
      }
      try {
        await upsertPuesto(id, {
          ...valores,
          activo: isEdit ? !!activaInput.checked : true,
          orden: puesto?.orden ?? orden,
          createdAt: puesto?.createdAt || Date.now(),
          updatedAt: Date.now(),
          createdBy: puesto?.createdBy || state.user?.uid || null
        });
        toast(isEdit ? 'Puesto actualizado' : `Puesto "${nom}" guardado`, 'ok');
        return { id, ...valores, guardado: true };
      } catch (err) {
        toast('Error: ' + err.message, 'danger');
        return false;
      }
    }
  });
}

export async function renderPuestos() {
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Puestos' }];
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando puestos…'));

  let puestos, empleados;
  try {
    [puestos, empleados] = await Promise.all([listPuestos(), listEmpleados()]);
  } catch (err) {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message));
    return;
  }

  const lista = puestosOrdenados(puestos);
  const usadosIds = new Set(lista.map(p => p.id));
  const refresh = () => renderPuestos();

  // Cuántos empleados usan cada puesto (por id o, si vienen de antes del
  // catálogo, por nombre).
  const enUso = {};
  for (const e of Object.values(empleados || {})) {
    const key = e.puestoId || slug(e.puesto || '', '');
    if (key) enUso[key] = (enUso[key] || 0) + 1;
  }

  const head = h('div', { class: 'row', style: { marginBottom: '8px' } }, [
    h('h1', { style: { margin: 0 } }, 'Puestos'),
    h('div', { style: { flex: 1 } }),
    h('button', {
      class: 'btn ghost',
      onClick: () => importarDeEmpleados(empleados, usadosIds, lista.length, refresh)
    }, 'Importar de empleados'),
    h('button', {
      class: 'btn primary',
      onClick: async () => {
        const r = await puestoDialog({ usadosIds, orden: lista.length + 1 });
        if (r) refresh();
      }
    }, '+ Nuevo puesto')
  ]);

  const intro = h('p', { class: 'muted', style: { margin: '0 0 16px' } },
    'Tabulador base: cada puesto guarda tipo de personal, sueldo, bono y SDI. Al dar de alta un empleado eliges el puesto y esos valores se precargan — después puedes ajustarlos empleado por empleado sin afectar el preset.');

  const body = lista.length === 0
    ? h('div', { class: 'card' }, [
      h('div', { class: 'empty' }, 'Todavía no hay puestos guardados.'),
      h('p', { class: 'muted', style: { fontSize: '12px', textAlign: 'center', margin: 0 } },
        'Crea el primero aquí, impórtalos de los empleados que ya diste de alta, o guárdalos sobre la marcha desde la ficha del empleado ("Puesto → + Nuevo puesto…").')
    ])
    : h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
      h('table', { class: 'tbl' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', {}, 'Puesto'),
          h('th', {}, 'Tipo'),
          h('th', { class: 'num' }, 'Sueldo base'),
          h('th', { class: 'num' }, 'Bono'),
          h('th', { class: 'num' }, 'Total período'),
          h('th', { class: 'num' }, '≈ Mensual'),
          h('th', { class: 'num' }, 'SDI'),
          h('th', { class: 'num' }, 'Empleados'),
          h('th', {}, 'Estado'),
          h('th', {}, '')
        ])]),
        h('tbody', {}, lista.map(p => puestoRow(p, enUso, usadosIds, refresh)))
      ])
    ]);

  renderShell(crumbs, h('div', {}, [head, intro, body]));
}

function puestoRow(p, enUso, usadosIds, refresh) {
  const activo = p.activo !== false;
  const total = (Number(p.sueldoBase) || 0) + (Number(p.bonos) || 0);
  const n = enUso[p.id] || 0;
  return h('tr', {}, [
    h('td', {}, [
      h('b', {}, p.nombre || p.id),
      h('div', { class: 'mono muted', style: { fontSize: '11px' } }, p.id)
    ]),
    h('td', {}, h('span', { class: 'tag' }, tipoPersonalLabel[p.tipo] || p.tipo || '—')),
    h('td', { class: 'num' }, money(p.sueldoBase)),
    h('td', { class: 'num muted' }, money(p.bonos)),
    h('td', { class: 'num' }, h('b', {}, money(total))),
    h('td', { class: 'num muted' }, money(mensualDe(p.tipo, total))),
    h('td', { class: 'num' }, Number(p.sdi) > 0 ? money(p.sdi) : h('span', { class: 'muted' }, '—')),
    h('td', { class: 'num muted' }, n > 0 ? String(n) : '—'),
    h('td', {}, activo
      ? h('span', { class: 'tag ok' }, 'Activo')
      : h('span', { class: 'tag muted' }, 'Inactivo')),
    h('td', {}, h('div', { class: 'row' }, [
      h('button', { class: 'btn sm ghost', onClick: () => toggleActivo(p, refresh) }, activo ? 'Desactivar' : 'Activar'),
      h('button', {
        class: 'btn sm ghost',
        onClick: async () => { const r = await puestoDialog({ puesto: p, usadosIds }); if (r) refresh(); }
      }, 'Editar'),
      h('button', { class: 'btn sm ghost danger', onClick: () => eliminarPuesto(p, n, refresh) }, '✕')
    ]))
  ]);
}

async function toggleActivo(p, refresh) {
  const { id, ...resto } = p;                 // `id` es la key, no un campo del nodo
  try {
    await upsertPuesto(id, { ...resto, activo: !(p.activo !== false), updatedAt: Date.now() });
    refresh();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}

async function eliminarPuesto(p, n, refresh) {
  const ok = await modal({
    title: 'Eliminar puesto',
    body: h('div', {}, [
      h('p', {}, `¿Eliminar el puesto "${p.nombre || p.id}" del catálogo?`),
      h('p', { class: 'muted', style: { fontSize: '12px' } },
        n > 0
          ? `${n} empleado(s) tienen este puesto. NO se les borra nada: conservan su nombre de puesto, sueldo, bono y SDI — solo desaparece del selector para futuras altas.`
          : 'Solo se borra el preset; no afecta a ningún empleado. Si únicamente quieres ocultarlo, usa "Desactivar".')
    ]),
    confirmLabel: 'Eliminar', danger: true
  });
  if (!ok) return;
  try {
    await removePuesto(p.id);
    toast('Puesto eliminado', 'ok');
    refresh();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}

// Siembra el catálogo con los puestos que ya escribiste a mano en las fichas.
// Para cada nombre distinto toma los valores del primer empleado (orden
// alfabético) que lo tenga; el resto se ajusta después editando el preset.
async function importarDeEmpleados(empleados, usadosIds, ordenBase, refresh) {
  const porPuesto = new Map();
  const filas = Object.values(empleados || {})
    .filter(e => (e.puesto || '').trim())
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));

  for (const e of filas) {
    const nombre = e.puesto.trim();
    const id = slug(nombre, 'puesto');
    if (usadosIds.has(id)) continue;                 // ya existe como preset
    if (!porPuesto.has(id)) {
      porPuesto.set(id, {
        id, nombre, n: 1,
        tipo: e.tipo || 'operativo',
        sueldoBase: Number(e.sueldoBase) || 0,
        bonos: Number(e.bonos) || 0,
        sdi: Number(e.sdi) || 0
      });
    } else {
      porPuesto.get(id).n++;
    }
  }

  const nuevos = [...porPuesto.values()];
  if (nuevos.length === 0) {
    toast('No hay puestos nuevos que importar de los empleados.', 'warn');
    return;
  }

  const ok = await modal({
    title: 'Importar puestos de empleados',
    body: h('div', {}, [
      h('p', { class: 'muted', style: { fontSize: '12px', marginTop: 0 } },
        'Se crearán estos presets con los valores del primer empleado de cada puesto. Ajústalos después si el tabulador es otro.'),
      h('div', { style: { maxHeight: '260px', overflow: 'auto' } },
        h('table', { class: 'tbl' }, [
          h('thead', {}, [h('tr', {}, [
            h('th', {}, 'Puesto'), h('th', {}, 'Tipo'),
            h('th', { class: 'num' }, 'Sueldo'), h('th', { class: 'num' }, 'Bono'),
            h('th', { class: 'num' }, 'SDI'), h('th', { class: 'num' }, 'Emp.')
          ])]),
          h('tbody', {}, nuevos.map(p => h('tr', {}, [
            h('td', {}, p.nombre),
            h('td', { class: 'muted' }, tipoPersonalLabel[p.tipo] || p.tipo),
            h('td', { class: 'num' }, money(p.sueldoBase)),
            h('td', { class: 'num muted' }, money(p.bonos)),
            h('td', { class: 'num muted' }, Number(p.sdi) > 0 ? money(p.sdi) : '—'),
            h('td', { class: 'num muted' }, String(p.n))
          ])))
        ]))
    ]),
    size: 'lg',
    confirmLabel: `Importar ${nuevos.length}`
  });
  if (!ok) return;

  try {
    let orden = ordenBase;
    for (const p of nuevos) {
      await upsertPuesto(p.id, {
        nombre: p.nombre, tipo: p.tipo,
        sueldoBase: p.sueldoBase, bonos: p.bonos, sdi: p.sdi,
        activo: true, orden: ++orden,
        createdAt: Date.now(), updatedAt: Date.now(),
        createdBy: state.user?.uid || null
      });
    }
    toast(`${nuevos.length} puesto(s) importado(s)`, 'ok');
    refresh();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}
