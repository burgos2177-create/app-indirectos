import { h } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import { navigate } from '../state/router.js';

// Landing de la app. Tarjetas de navegación a las secciones principales.
// Indirectos no es una app por-obra (a diferencia de materiales/compras),
// así que el entry-point es un dashboard con accesos directos.
export function renderHome() {
  const isAdmin = state.user.role === 'admin';

  const cards = [
    card('👷', 'Empleados', 'Alta y catálogo del personal. Obras asignadas y peso de prorrateo.', '/empleados'),
    card('📊', 'Proyección', 'Arma plantillas hipotéticas y proyecta el costo semanal, quincenal, mensual y anual.', '/proyeccion'),
    card('📅', 'Períodos de nómina', '4 carriles: operativo (semanal) + 3 quincenales. Captura días, deducciones, neto.', '/periodos'),
    card('💸', 'Gastos indirectos', 'Captura suelta: oficina, gasolina, etc. Atribución a obra única, prorrateo, o empresa.', '/gastos'),
    isAdmin && card('🏷️', 'Categorías', 'Catálogo editable de categorías de gasto.', '/categorias', 'Admin'),
    isAdmin && card('🗓️', 'Calendario semanal', 'Configura el día de inicio/corte de la nómina de operativos.', '/configuracion', 'Admin'),
    isAdmin && card('⚙️', 'Usuarios', 'Crear aux_admin, asignar obras, gestionar roles.', '/admin', 'Admin')
  ].filter(Boolean);

  renderShell([{ label: 'Inicio' }], h('div', {}, [
    h('h1', {}, 'Indirectos SGR'),
    h('p', { class: 'muted', style: { marginBottom: '8px' } },
      'Planificación de nóminas y gastos indirectos. Las aprobaciones de pago las hace el contador en la bitácora.'),
    h('div', { class: 'home-grid' }, cards)
  ]));
}

function card(ico, title, desc, path, badge) {
  return h('div', { class: 'home-card', onClick: () => navigate(path) }, [
    h('div', { class: 'ico' }, ico),
    h('h3', {}, title),
    h('p', {}, desc),
    badge ? h('span', { class: 'badge' }, badge) : null
  ]);
}
