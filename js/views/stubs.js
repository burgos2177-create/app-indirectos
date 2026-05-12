// Vistas stub para las secciones todavía no implementadas. Cada una respeta
// el shell + crumbs y muestra un placeholder con el siguiente paso.
import { h } from '../util/dom.js';
import { renderShell } from './shell.js';

function stub(crumbs, title, descripcion, siguientePaso) {
  renderShell(crumbs, h('div', {}, [
    h('h1', {}, title),
    h('div', { class: 'card' }, [
      h('div', { class: 'muted' }, descripcion),
      h('div', { style: { marginTop: '14px', fontSize: '12px' } }, [
        h('span', { class: 'tag warn' }, 'Pendiente'),
        h('span', { style: { marginLeft: '8px', color: 'var(--text-1)' } }, siguientePaso)
      ])
    ])
  ]));
}

export function renderPeriodosStub() {
  stub(
    [{ label: 'Inicio', to: '/' }, { label: 'Períodos' }],
    'Períodos de nómina',
    '4 carriles independientes: operativo (semanal lun-vie), técnico campo (quincenal), técnico oficina (quincenal), directivo (quincenal). Cada carril publica su propio item al buzón.',
    'Pendiente: vista resumen del período actual de cada carril, listado histórico, botón "Armar período actual".'
  );
}

export function renderPeriodoStub(params) {
  stub(
    [{ label: 'Inicio', to: '/' }, { label: 'Períodos', to: '/periodos' }, { label: params?.id || 'Detalle' }],
    'Detalle del período',
    'Tabla de empleados del tipo con sueldo base, días trabajados, horas extra, bonos, prestaciones, deducciones (ISR/IMSS/INFONAVIT/préstamos), neto a pagar. Deducciones se prefillan del período anterior.',
    'Pendiente: tabla editable con cálculo en vivo del neto, botón "Cerrar y enviar al buzón".'
  );
}

export function renderGastosStub() {
  stub(
    [{ label: 'Inicio', to: '/' }, { label: 'Gastos' }],
    'Gastos indirectos',
    'Captura suelta de gastos: oficina, gasolina, etc. Cada gasto se carga en uno de 3 modos: obra única / prorrateo entre varias obras / empresa SOGRUB (sin obra).',
    'Pendiente: form de captura con los 3 modos, selector de categoría, selector de conceptoKey opcional, listado, publicación al buzón.'
  );
}

export function renderCategoriasStub() {
  stub(
    [{ label: 'Inicio', to: '/' }, { label: 'Categorías' }],
    'Categorías de gasto',
    'Catálogo editable de categorías que aparece como dropdown al capturar un gasto indirecto.',
    'Pendiente: CRUD de categorías (semillas: oficina, gasolina, servicios, telefonía, viáticos, mantenimiento, otros).'
  );
}

export function renderConfiguracionStub() {
  stub(
    [{ label: 'Inicio', to: '/' }, { label: 'Configuración' }],
    'Configuración',
    'Calendario semanal para nómina de operativos: día de inicio, día de corte, días laborables.',
    'Pendiente: form de edición del calendario en /shared/indirectos/meta.calendarioSemanal.'
  );
}
