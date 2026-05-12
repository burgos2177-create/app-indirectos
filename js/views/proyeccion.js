import { h, toast, modal } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import {
  listEscenarios, createEscenario, removeEscenario
} from '../services/db.js';
import { navigate } from '../state/router.js';
import { money, dateMx, num0 } from '../util/format.js';
import { calcularProyeccion } from './escenario.js';

export async function renderProyeccionList() {
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Proyección' }];
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando escenarios…'));

  let escenarios;
  try {
    escenarios = await listEscenarios();
  } catch (err) {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message));
    return;
  }

  const ids = Object.keys(escenarios || {});

  const head = h('div', { class: 'row', style: { marginBottom: '8px' } }, [
    h('h1', { style: { margin: 0 } }, 'Proyección de nómina'),
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'btn primary', onClick: () => nuevoEscenarioDialog() }, '+ Nuevo escenario')
  ]);
  const intro = h('p', { class: 'muted', style: { margin: '0 0 16px' } },
    'Arma plantillas hipotéticas para ver el costo de la nómina semanal, quincenal, mensual y anual. Los escenarios no afectan a tus empleados reales ni publican al buzón — son solo para planeación.');

  const body = ids.length === 0
    ? h('div', { class: 'empty' }, [
        h('div', { class: 'ico' }, '📊'),
        h('div', {}, 'No hay escenarios todavía. Crea el primero para empezar a proyectar.')
      ])
    : h('div', { class: 'escenarios-grid' }, ids.map(id => escenarioCard(id, escenarios[id])));

  renderShell(crumbs, h('div', {}, [head, intro, body]));
}

function escenarioCard(id, esc) {
  const empleados = Object.values(esc.empleados || {});
  const proy = calcularProyeccion(empleados, esc.meta?.factorPatronal ?? 1.35);
  return h('div', { class: 'escenario-card' }, [
    h('div', { class: 'esc-head', onClick: () => navigate('/proyeccion/' + id) }, [
      h('h3', {}, esc.meta?.nombre || 'Sin nombre'),
      esc.meta?.descripcion ? h('p', { class: 'muted' }, esc.meta.descripcion) : null,
      h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } },
        `Actualizado ${dateMx(esc.meta?.updatedAt || esc.meta?.createdAt)}`)
    ]),
    h('div', { class: 'esc-kpis' }, [
      kpiMini('Plantilla', `${num0(empleados.length)} pers.`),
      kpiMini('Semanal (op.)', money(proy.brutoSemanal)),
      kpiMini('Quincenal', money(proy.brutoQuincenal)),
      kpiMini('Mensual', money(proy.brutoMensual), 'highlight'),
      kpiMini('Costo total mes', money(proy.costoTotalMensual), 'highlight')
    ]),
    h('div', { class: 'esc-actions' }, [
      h('button', { class: 'btn sm ghost', onClick: () => navigate('/proyeccion/' + id) }, 'Editar'),
      h('button', { class: 'btn sm ghost danger', onClick: () => eliminarEscenario(id, esc) }, 'Eliminar')
    ])
  ]);
}

function kpiMini(label, value, cls = '') {
  return h('div', { class: 'kpi-mini ' + cls }, [
    h('span', { class: 'kpi-label' }, label),
    h('span', { class: 'kpi-value' }, value)
  ]);
}

async function nuevoEscenarioDialog() {
  const nombre = h('input', { placeholder: 'Plantilla base 2026', autofocus: true });
  const descripcion = h('input', { placeholder: 'Descripción (opcional)' });
  const factor = h('input', { type: 'number', step: '0.01', min: '1', value: '1.35' });

  await modal({
    title: 'Nuevo escenario',
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'Nombre'), nombre]),
      h('div', { class: 'field' }, [h('label', {}, 'Descripción'), descripcion]),
      h('div', { class: 'field' }, [
        h('label', {}, 'Factor patronal (× sueldo bruto)'),
        factor,
        h('span', { class: 'muted', style: { fontSize: '11px' } },
          'Aproxima el costo total para la empresa (sueldo + cuotas IMSS patrón + INFONAVIT + RCV + impuestos). Default 1.35 = +35%. Ajustable por escenario.')
      ])
    ]),
    confirmLabel: 'Crear',
    onConfirm: async () => {
      try {
        const newId = await createEscenario({
          nombre: nombre.value.trim() || 'Escenario sin nombre',
          descripcion: descripcion.value.trim() || null,
          factorPatronal: Number(factor.value) || 1.35,
          createdBy: state.user?.uid
        });
        toast('Escenario creado', 'ok');
        navigate('/proyeccion/' + newId);
        return true;
      } catch (err) {
        toast('Error: ' + err.message, 'danger');
        return false;
      }
    }
  });
}

async function eliminarEscenario(id, esc) {
  const ok = await modal({
    title: 'Eliminar escenario',
    body: `¿Eliminar "${esc.meta?.nombre || 'sin nombre'}"? Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar', danger: true
  });
  if (!ok) return;
  try {
    await removeEscenario(id);
    toast('Escenario eliminado', 'ok');
    renderProyeccionList();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}
