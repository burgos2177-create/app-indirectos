import { onAuth, getUserProfile, canAccess } from './services/auth.js';
import { state, setState } from './state/store.js';
import { route, startRouter, navigate } from './state/router.js';
import { renderLogin } from './views/login.js';
import { renderHome } from './views/home.js';
import { renderAdmin } from './views/admin.js';
import { renderEmpleados } from './views/empleados.js';
import { renderEmpleadoEditor } from './views/empleado.js';
import {
  renderPeriodosStub, renderPeriodoStub,
  renderGastosStub, renderCategoriasStub, renderConfiguracionStub
} from './views/stubs.js';
import { h, mount } from './util/dom.js';

route('/',                       () => renderHome());
route('/admin',                  () => renderAdmin());
route('/empleados',              (ctx) => renderEmpleados(ctx));
route('/empleados/:id',          (ctx) => renderEmpleadoEditor(ctx));
route('/periodos',               () => renderPeriodosStub());
route('/periodos/:id',           ({ params }) => renderPeriodoStub(params));
route('/gastos',                 () => renderGastosStub());
route('/categorias',             () => renderCategoriasStub());
route('/configuracion',          () => renderConfiguracionStub());

let started = false;

onAuth(async (fbUser) => {
  if (!fbUser) {
    setState({ user: null });
    renderLogin();
    return;
  }
  let profile = null;
  try { profile = await getUserProfile(fbUser.uid); }
  catch (err) { console.error('No se pudo leer /legacy/estimaciones/users/{uid}', err); }

  if (!profile) {
    mount('#app', h('div', { class: 'login-shell' }, h('div', { class: 'login-card' }, [
      h('h1', {}, 'Sin acceso'),
      h('p', { class: 'sub' }, 'Tu cuenta existe pero no tienes un perfil registrado en la suite.'),
      h('p', { class: 'sub muted', style: { fontSize: '12px' } },
        'Pide al administrador que te dé de alta en la app de estimaciones o aquí mismo.'),
      h('button', { class: 'btn', onClick: async () => {
        const { logout } = await import('./services/auth.js');
        logout();
      } }, 'Salir')
    ])));
    return;
  }

  const userWithProfile = { uid: fbUser.uid, email: fbUser.email, ...profile };

  if (!canAccess(userWithProfile)) {
    mount('#app', h('div', { class: 'login-shell' }, h('div', { class: 'login-card' }, [
      h('h1', {}, 'Sin acceso'),
      h('p', { class: 'sub' }, `Tu rol (${profile.role || '—'}) no tiene acceso a indirectos.`),
      h('p', { class: 'sub muted', style: { fontSize: '12px' } },
        'Solo aux_admin y admin pueden entrar. Pide al administrador que te cambie el rol o usa las otras apps de la suite.'),
      h('button', { class: 'btn', onClick: async () => {
        const { logout } = await import('./services/auth.js');
        logout();
      } }, 'Salir')
    ])));
    return;
  }

  setState({ user: userWithProfile });
  if (!started) { startRouter(); started = true; }
  else { navigate('/'); }
});
