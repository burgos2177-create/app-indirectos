import { h, toast, modal } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import {
  listCategoriasGasto, seedCategoriasGastoSiVacio,
  upsertCategoriaGasto, removeCategoriaGasto
} from '../services/db.js';

function slug(s) {
  const acentos = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };
  return (s || '').toString().toLowerCase()
    .replace(/[áéíóúüñ]/g, ch => acentos[ch] || ch)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'categoria';
}

export async function renderCategorias() {
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Categorías' }];
  if (state.user?.role !== 'admin') {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Solo el administrador puede gestionar las categorías de gasto.'));
    return;
  }
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando categorías…'));

  let cats;
  try {
    await seedCategoriasGastoSiVacio();
    cats = await listCategoriasGasto();
  } catch (err) {
    renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message));
    return;
  }

  const refresh = () => renderCategorias();
  const usadosIds = new Set(cats.map(c => c.id));

  const head = h('div', { class: 'row', style: { marginBottom: '8px' } }, [
    h('h1', { style: { margin: 0 } }, 'Categorías de gasto'),
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'btn primary', onClick: () => categoriaDialog({ usadosIds, orden: cats.length + 1, onDone: refresh }) }, '+ Nueva categoría')
  ]);
  const intro = h('p', { class: 'muted', style: { margin: '0 0 16px' } },
    'Estas categorías aparecen como dropdown al capturar un gasto indirecto. Desactiva una para ocultarla sin perder el histórico.');

  const table = h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
    h('table', { class: 'tbl' }, [
      h('thead', {}, [h('tr', {}, [
        h('th', { class: 'num', style: { width: '60px' } }, 'Orden'),
        h('th', {}, 'Nombre'),
        h('th', { class: 'mono' }, 'ID'),
        h('th', {}, 'Estado'),
        h('th', {}, '')
      ])]),
      h('tbody', {}, cats.map(c => categoriaRow(c, usadosIds, refresh)))
    ])
  ]);

  renderShell(crumbs, h('div', {}, [head, intro, table]));
}

function categoriaRow(c, usadosIds, refresh) {
  const activa = c.activa !== false;
  return h('tr', {}, [
    h('td', { class: 'num muted' }, String(c.orden ?? '—')),
    h('td', {}, h('b', {}, c.nombre || c.id)),
    h('td', { class: 'mono muted', style: { fontSize: '12px' } }, c.id),
    h('td', {}, activa ? h('span', { class: 'tag ok' }, 'Activa') : h('span', { class: 'tag muted' }, 'Inactiva')),
    h('td', {}, h('div', { class: 'row' }, [
      h('button', { class: 'btn sm ghost', onClick: () => toggleActiva(c, refresh) }, activa ? 'Desactivar' : 'Activar'),
      h('button', { class: 'btn sm ghost', onClick: () => categoriaDialog({ cat: c, usadosIds, onDone: refresh }) }, 'Editar'),
      h('button', { class: 'btn sm ghost danger', onClick: () => eliminarCategoria(c, refresh) }, '✕')
    ]))
  ]);
}

async function categoriaDialog({ cat = null, usadosIds, orden = 1, onDone }) {
  const isEdit = !!cat;
  const nombre = h('input', { value: cat?.nombre || '', placeholder: 'Ej. Papelería' });
  const ordenInput = h('input', { type: 'number', step: '1', min: '0', value: cat?.orden ?? orden });
  const activaInput = h('input', { type: 'checkbox', checked: cat ? cat.activa !== false : true });

  await modal({
    title: isEdit ? 'Editar categoría' : 'Nueva categoría',
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'Nombre'), nombre]),
      h('div', { class: 'grid-2', style: { marginTop: '10px' } }, [
        h('div', { class: 'field' }, [h('label', {}, 'Orden'), ordenInput]),
        h('label', { class: 'row', style: { gap: '8px', alignItems: 'center', marginTop: '22px' } }, [
          activaInput, h('span', {}, 'Activa')
        ])
      ]),
      isEdit ? h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '8px' } }, `ID: ${cat.id} (no cambia al editar)`) : null
    ]),
    confirmLabel: isEdit ? 'Guardar' : 'Crear',
    onConfirm: async () => {
      const nom = nombre.value.trim();
      if (!nom) { toast('Nombre obligatorio', 'warn'); return false; }
      let id = isEdit ? cat.id : slug(nom);
      if (!isEdit && usadosIds.has(id)) {
        let i = 2;
        while (usadosIds.has(`${id}_${i}`)) i++;
        id = `${id}_${i}`;
      }
      const data = {
        nombre: nom,
        activa: !!activaInput.checked,
        orden: Number(ordenInput.value) || 0,
        createdAt: cat?.createdAt || Date.now()
      };
      try {
        await upsertCategoriaGasto(id, data);
        toast(isEdit ? 'Categoría actualizada' : 'Categoría creada', 'ok');
        onDone();
        return true;
      } catch (err) { toast('Error: ' + err.message, 'danger'); return false; }
    }
  });
}

async function toggleActiva(c, refresh) {
  try {
    await upsertCategoriaGasto(c.id, {
      nombre: c.nombre, activa: !(c.activa !== false),
      orden: c.orden || 0, createdAt: c.createdAt || Date.now()
    });
    refresh();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}

async function eliminarCategoria(c, refresh) {
  const ok = await modal({
    title: 'Eliminar categoría',
    body: h('div', {}, [
      h('p', {}, `¿Eliminar la categoría "${c.nombre || c.id}"?`),
      h('p', { class: 'muted', style: { fontSize: '12px' } },
        'Los gastos ya capturados con esta categoría conservan su nombre. Si solo quieres ocultarla, usa "Desactivar".')
    ]),
    confirmLabel: 'Eliminar', danger: true
  });
  if (!ok) return;
  try {
    await removeCategoriaGasto(c.id);
    toast('Categoría eliminada', 'ok');
    refresh();
  } catch (err) { toast('Error: ' + err.message, 'danger'); }
}
