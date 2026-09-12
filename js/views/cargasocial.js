import { h, toast, modal } from '../util/dom.js';
import { renderShell } from './shell.js';
import { state } from '../state/store.js';
import {
  listEmpleados,
  pushBuzonItem, getBuzonItem, deleteBuzonItem,
  getCargaSocialMes, updateCargaSocialMes, removeCargaSocialMes,
  getProyectoIdByObraId, buzonEstadoActivo
} from '../services/db.js';
import { money, num, num0, dateMx, tipoPersonalLabel } from '../util/format.js';
import { clasificacionDe } from '../util/clasificacion.js';
import { calcularFiniquito } from '../util/finiquito.js';
import {
  parametrosVigentes, sbcDe, diasCotizados, calcularCuotasEmpleado,
  inicioMes, finMes, rangoBimestre, cierraBimestre, vencimientoCuotas,
  MODO_REDONDEO, round2
} from '../util/imss.js';
import { cargarSheetJS, parseEmision, emparejar } from '../util/sipare.js';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function mesActualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function mesLabel(mesISO) {
  const [y, m] = String(mesISO).split('-');
  return `${MESES[(Number(m) || 1) - 1]} ${y}`;
}
function mesPrevioDelBimestre(mesISO) {
  const [y, m] = String(mesISO).split('-').map(Number);
  return m % 2 === 0 ? `${y}-${String(m - 1).padStart(2, '0')}` : null;
}

// Base del prorrateo a obras.
//
// El §7 del contrato de carga social manda prorratear el COSTO PATRONAL. Eso
// aplica cuando la nómina carga el BRUTO a la obra; esta app carga el NETO
// (ver el item de nómina: monto.importe = totalNeto). Con nómina en neto, la
// cuota obrera retenida no está contabilizada en ningún lado, así que
// prorratear el SIPARE completo deja el costo de obra exacto:
//   neto + SIPARE = (bruto − retenciones) + patronal + retenciones = bruto + patronal
// Además así el prorrateo suma exactamente monto.importe y bitácora no marca
// diferencia. Cambiar a 'costo_patronal' si algún día la nómina pasa a bruto.
const BASE_PRORRATEO = 'sipare';

export async function renderCargaSocial() {
  const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Carga social' }];
  renderShell(crumbs, h('div', { class: 'empty' }, 'Cargando…'));

  let empleados;
  try { empleados = await listEmpleados(); }
  catch (err) { renderShell(crumbs, h('div', { class: 'empty' }, 'Error: ' + err.message)); return; }

  const empById = empleados || {};
  const activos = Object.entries(empById)
    .map(([id, e]) => ({ id, ...e }))
    .filter(e => e.activo !== false)
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));

  let mesSel = mesActualISO();
  let ausencias = {};        // empleadoId → días de ausentismo/incapacidad del mes
  let ausenciasPrevias = {}; // ídem del mes impar del bimestre (para la base bimestral)
  let filas = [];            // cálculo vivo por empleado
  // Emisión oficial del despacho (la que genera la línea de captura SIPARE).
  // Cuando existe manda ella: es el monto exacto que se va a pagar.
  let emision = null;
  let modo = 'estimado';     // 'estimado' | 'oficial'

  // ===== Cálculo del mes =====
  function calcularMes() {
    const params = parametrosVigentes(mesSel);
    const bim = rangoBimestre(mesSel);
    const conBimestre = cierraBimestre(mesSel);
    const hasta = finMes(mesSel);

    filas = activos.map((e) => {
      const fin = calcularFiniquito(e, hasta);
      const s = sbcDe(e, params, { sdi: fin.sdi, factorIntegracion: fin.factorIntegracion });
      const ausMes = Number(ausencias[e.id]) || 0;
      const ausBim = ausMes + (Number(ausenciasPrevias[e.id]) || 0);
      const dMes = diasCotizados(e, inicioMes(mesSel), finMes(mesSel), ausMes);
      const dBim = diasCotizados(e, bim.inicio, bim.fin, ausBim);
      const cuotas = calcularCuotasEmpleado({
        sbc: s.sbc,
        salarioDiario: s.salarioDiario,
        diasMes: dMes.cotizados,
        diasBimestre: dBim.cotizados,
        incluyeBimestral: conBimestre,
        params
      });
      return {
        id: e.id, nombre: e.nombre || '(sin nombre)', tipo: e.tipo,
        clasif: clasificacionDe(e.tipo),
        obrasAsignadas: e.obrasAsignadas || {},
        sdiRegistrado: s.registrado, topeAplicado: s.topeAplicado,
        factorIntegracion: fin.factorIntegracion,
        dMes, dBim, cuotas
      };
    });
    return { params, bim, conBimestre };
  }

  function totales() {
    const t = {
      imss: 0, retiro: 0, ceav: 0, infonavit: 0,
      patron: 0, obrero: 0, sipare: 0, retenido: 0, costoPatronal: 0, conCuota: 0
    };
    for (const f of filas) {
      const c = f.cuotas;
      if (c.totalSipare <= 0) continue;
      t.conCuota++;
      t.imss += c.imss; t.retiro += c.retiro; t.ceav += c.ceav; t.infonavit += c.infonavit;
      t.patron += c.totalPatron; t.obrero += c.totalObrero;
      t.sipare += c.totalSipare; t.retenido += c.cuotaRetenida; t.costoPatronal += c.costoPatronal;
    }
    return t;
  }

  // ===== Encabezado y controles =====
  const mesInput = h('input', {
    type: 'month', value: mesSel, style: { maxWidth: '180px' },
    onChange: async () => { mesSel = mesInput.value || mesActualISO(); await recargarMes(); }
  });
  const bimBadge = h('span', { class: 'tag' }, '');
  const vencBadge = h('span', { class: 'tag' }, '');

  // ===== Tarjetas =====
  const paramsCard = h('div', { class: 'card' }, []);
  const kpiWrap = h('div', {});
  const desgloseCard = h('div', { class: 'card' }, []);
  const tablaWrap = h('div', {});
  const enviadaBanner = h('div', {});

  function pintarParametros(params) {
    paramsCard.innerHTML = '';
    const dato = (label, valor, nota) => h('div', { class: 'kpi' }, [
      h('span', { class: 'kpi-label' }, label),
      h('span', { class: 'kpi-value' }, valor),
      nota ? h('span', { class: 'muted', style: { fontSize: '10px' } }, nota) : null
    ]);
    paramsCard.appendChild(h('h3', {}, 'Parámetros de ley vigentes'));
    paramsCard.appendChild(h('div', { class: 'kpi-row' }, [
      dato('UMA diaria', money(params.umaDiaria), `desde ${params.desde}`),
      dato('Salario mínimo', money(params.salarioMinimo)),
      dato('Tope SBC (25 UMA)', money(params.topeSBC)),
      dato('3 UMA (excedente EyM)', money(params.tresUMA)),
      dato('Prima RT', num(params.primaRT * 100, 5) + '%', 'Clase V media')
    ]));
    paramsCard.appendChild(h('p', { class: 'muted', style: { fontSize: '11px', margin: '10px 0 0' } },
      `${params.nota}. La UMA cambia cada 1 de febrero y la prima de riesgo cada 1 de marzo; ambas se editan en js/util/imss.js con su fecha de vigencia. Redondeo: a dos decimales ${MODO_REDONDEO === 'ramo' ? 'por ramo y por trabajador (como el SUA)' : 'solo en el total'}.`));
  }

  function pintarKpis(t, conBimestre) {
    const kpi = (label, valor, cls = '', nota) => h('div', { class: 'kpi ' + cls }, [
      h('span', { class: 'kpi-label' }, label),
      h('span', { class: 'kpi-value' }, valor),
      nota ? h('span', { class: 'muted', style: { fontSize: '10px' } }, nota) : null
    ]);
    kpiWrap.innerHTML = '';
    kpiWrap.appendChild(h('div', { class: 'kpi-row' }, [
      kpi('Trabajadores con cuota', num0(t.conCuota) + ' / ' + num0(filas.length)),
      kpi('IMSS (mensual)', money(t.imss)),
      kpi('Retiro + CEAV', conBimestre ? money(t.retiro + t.ceav) : money(0), '', conBimestre ? null : 'no aplica este mes'),
      kpi('INFONAVIT', conBimestre ? money(t.infonavit) : money(0), '', conBimestre ? null : 'no aplica este mes'),
      kpi('Total SIPARE', money(t.sipare), 'accent'),
      kpi('Retenido en nómina', money(t.retenido), '', 'no es costo patronal'),
      kpi('Costo patronal', money(t.costoPatronal), 'highlight')
    ]));
  }

  function pintarDesglose(t, conBimestre, venc, bim) {
    desgloseCard.innerHTML = '';
    const fila = (label, valor, nota) => h('div', { class: 'tipo-row', style: { gridTemplateColumns: '1fr auto' } }, [
      h('div', {}, [h('span', { class: 'muted' }, label), nota ? h('span', { class: 'muted', style: { fontSize: '10px', marginLeft: '6px' } }, nota) : null]),
      h('div', { class: 'tipo-val' }, h('b', {}, money(valor)))
    ]);
    desgloseCard.appendChild(h('h3', {}, 'Línea de captura SIPARE'));
    desgloseCard.appendChild(h('div', { class: 'tipo-breakdown' }, [
      fila('IMSS (cuotas del mes)', t.imss),
      conBimestre ? fila('Retiro (2%)', t.retiro, bim.label) : null,
      conBimestre ? fila('CEAV', t.ceav, bim.label) : null,
      conBimestre ? fila('INFONAVIT (5%)', t.infonavit, bim.label) : null
    ].filter(Boolean)));
    desgloseCard.appendChild(h('div', { class: 'kpi accent', style: { marginTop: '10px', maxWidth: '320px' } }, [
      h('span', { class: 'kpi-label' }, 'Total a pagar (SIPARE)'),
      h('span', { class: 'kpi-value' }, money(t.sipare))
    ]));
    desgloseCard.appendChild(h('p', { class: 'muted', style: { fontSize: '11px', margin: '10px 0 0' } }, [
      `Fecha límite de pago: ${dateMx(venc)}. `,
      conBimestre
        ? `Incluye el bimestral (${bim.label}); el día 17 se recorre al siguiente hábil si cae en fin de semana.`
        : 'Este mes solo causa el IMSS mensual; el bimestral se paga al cierre del bimestre.'
    ]));
  }

  // ===== Tabla =====
  function pintarTabla(conBimestre) {
    tablaWrap.innerHTML = '';
    if (filas.length === 0) {
      tablaWrap.appendChild(h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '🧾'), h('div', {}, 'No hay empleados activos.')]));
      return;
    }
    const tbody = h('tbody', {}, filas.map(f => filaEl(f, conBimestre)));
    tablaWrap.appendChild(h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
      h('table', { class: 'tbl' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', {}, 'Empleado'),
          h('th', {}, 'Clasificación'),
          h('th', { class: 'num' }, 'SBC'),
          h('th', { class: 'num' }, 'UMA'),
          h('th', { class: 'num' }, 'Días nat.'),
          h('th', { class: 'num' }, 'Ausencias'),
          h('th', { class: 'num' }, 'Días cotiz.'),
          h('th', { class: 'num sep-l' }, 'IMSS'),
          h('th', { class: 'num' }, conBimestre ? 'RCV + INFO' : 'RCV + INFO'),
          h('th', { class: 'num' }, 'SIPARE'),
          h('th', { class: 'num' }, 'Retenido'),
          h('th', { class: 'num' }, 'Costo patronal'),
          h('th', {}, '')
        ])]),
        tbody
      ])
    ]));
  }

  function filaEl(f, conBimestre) {
    const c = f.cuotas;
    const ausInput = h('input', {
      type: 'number', step: '1', min: '0', class: 'cell', style: { width: '64px' },
      value: Number(ausencias[f.id]) || 0,
      title: 'Días de ausentismo e incapacidad: se restan de los días cotizados',
      onInput: () => { ausencias[f.id] = Math.max(0, Number(ausInput.value) || 0); repintar(); }
    });
    const sbcCell = h('td', { class: 'num' }, [
      money(c.sbc),
      h('div', { class: 'muted', style: { fontSize: '10px' } },
        f.sdiRegistrado ? 'SDI registrado' : 'SDI estimado'),
      f.topeAplicado ? h('div', {}, h('span', { class: 'tag warn', style: { fontSize: '9px' } }, 'topado 25 UMA')) : null
    ]);
    return h('tr', {}, [
      h('td', {}, [
        h('b', {}, f.nombre),
        h('div', { class: 'muted', style: { fontSize: '10px' } }, tipoPersonalLabel[f.tipo] || f.tipo),
        c.art36 ? h('span', { class: 'tag ok', style: { fontSize: '9px' } }, 'art. 36 · patrón absorbe') : null
      ]),
      h('td', {}, h('span', { class: 'tag ' + (f.clasif.clasificacion === 'directo' ? 'ok' : f.clasif.ambito === 'campo' ? 'warn' : '') }, f.clasif.label)),
      sbcCell,
      h('td', { class: 'num muted' }, num(c.sbcEnUMA, 3)),
      h('td', { class: 'num muted' }, num0(f.dMes.naturales)),
      h('td', { class: 'cell-td' }, ausInput),
      h('td', { class: 'num' }, h('b', {}, num0(f.dMes.cotizados))),
      h('td', { class: 'num sep-l' }, money(c.imss)),
      h('td', { class: 'num' }, conBimestre ? money(c.retiro + c.ceav + c.infonavit) : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'num' }, money(c.totalSipare)),
      h('td', { class: 'num muted' }, money(c.cuotaRetenida)),
      h('td', { class: 'neto' }, money(c.costoPatronal)),
      h('td', {}, h('button', { class: 'btn sm ghost', onClick: () => verDesglose(f) }, 'Desglose'))
    ]);
  }

  async function verDesglose(f) {
    const c = f.cuotas;
    const cab = (t) => h('h4', { style: { margin: '14px 0 6px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-1)' } }, t);
    const tablaRamos = (ramos, dias) => h('table', { class: 'tbl' }, [
      h('thead', {}, [h('tr', {}, [
        h('th', {}, 'Ramo'), h('th', { class: 'num' }, 'Tasa patrón'), h('th', { class: 'num' }, 'Tasa obrero'),
        h('th', { class: 'num' }, `Base × ${num0(dias)} d`), h('th', { class: 'num' }, 'Patrón'), h('th', { class: 'num' }, 'Obrero')
      ])]),
      h('tbody', {}, ramos.map(r => h('tr', {}, [
        h('td', {}, r.label),
        h('td', { class: 'num muted' }, num(r.tasaPatron * 100, r.key === 'rt' ? 5 : 3) + '%'),
        h('td', { class: 'num muted' }, r.tasaObrero ? num(r.tasaObrero * 100, 3) + '%' : '—'),
        h('td', { class: 'num muted' }, money(r.base)),
        h('td', { class: 'num' }, money(r.patron)),
        h('td', { class: 'num' }, r.obrero ? money(r.obrero) : h('span', { class: 'muted' }, '—'))
      ])))
    ]);

    await modal({
      title: `${f.nombre} · ${mesLabel(mesSel)}`,
      size: 'xl',
      confirmLabel: 'Cerrar',
      body: h('div', {}, [
        h('div', { class: 'kpi-row' }, [
          h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'SBC'), h('span', { class: 'kpi-value' }, money(c.sbc))]),
          h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'SBC en UMA'), h('span', { class: 'kpi-value' }, num(c.sbcEnUMA, 3))]),
          h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Salario diario'), h('span', { class: 'kpi-value' }, money(c.salarioDiario))]),
          h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Factor integración'), h('span', { class: 'kpi-value' }, num(f.factorIntegracion, 4))]),
          h('div', { class: 'kpi' }, [h('span', { class: 'kpi-label' }, 'Días cotizados'), h('span', { class: 'kpi-value' }, num0(c.diasMes))])
        ]),
        c.art36
          ? h('div', { class: 'readonly-banner', style: { marginTop: '10px' } }, [
              h('span', { class: 'tag ok' }, 'Art. 36 LSS'),
              h('span', {}, 'Percibe el salario mínimo: la cuota obrera la paga íntegra el patrón. No se le retiene nada en nómina, pero el importe sí es costo patronal.')
            ])
          : null,
        cab(`Cuotas mensuales — ${f.dMes.cotizados} días cotizados`),
        tablaRamos(c.mensuales, c.diasMes),
        c.incluyeBimestral ? cab(`Cuotas bimestrales — ${f.dBim.cotizados} días del bimestre`) : null,
        c.incluyeBimestral ? tablaRamos(c.bimestrales, c.diasBimestre) : null,
        h('div', { class: 'tipo-breakdown', style: { marginTop: '14px' } }, [
          h('div', { class: 'tipo-row', style: { gridTemplateColumns: '1fr auto' } }, [
            h('div', { class: 'muted' }, 'Total SIPARE (se deposita al IMSS)'), h('div', { class: 'tipo-val' }, h('b', {}, money(c.totalSipare)))
          ]),
          h('div', { class: 'tipo-row', style: { gridTemplateColumns: '1fr auto' } }, [
            h('div', { class: 'muted' }, 'Cuota retenida en nómina'), h('div', { class: 'tipo-val' }, h('b', {}, money(c.cuotaRetenida)))
          ]),
          h('div', { class: 'tipo-row', style: { gridTemplateColumns: '1fr auto' } }, [
            h('div', { class: 'muted' }, 'Costo patronal'), h('div', { class: 'tipo-val' }, h('b', { style: { color: 'var(--accent)' } }, money(c.costoPatronal)))
          ])
        ])
      ])
    });
  }

  // ===== Emisión oficial (desglose del despacho → línea de captura SIPARE) =====

  /** Trabajadores de la emisión ya emparejados con el catálogo de empleados. */
  function emisionEmparejada() {
    if (!emision) return [];
    return emparejar(emision.trabajadores || [], empById).map((t) => {
      const emp = t.empleadoId ? empById[t.empleadoId] : null;
      const f = filas.find((x) => x.id === t.empleadoId) || null;
      return {
        ...t,
        emp,
        clasif: emp ? clasificacionDe(emp.tipo) : null,
        obrasAsignadas: emp?.obrasAsignadas || {},
        // El art. 36 no viene en el archivo; se toma del cálculo de la app.
        art36: f ? f.cuotas.art36 : false,
        estimado: f ? f.cuotas.totalSipare : null
      };
    });
  }

  async function importarEmisionDialog() {
    const archivo = h('input', { type: 'file', accept: '.xls,.xlsx,.xlsm' });
    const estado = h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '10px' } },
      'Selecciona el archivo tal como lo manda la contadora; no hace falta editarlo.');
    const previa = h('div', { style: { marginTop: '12px' } });
    let parseada = null;

    archivo.addEventListener('change', async () => {
      const f = archivo.files?.[0];
      previa.innerHTML = '';
      parseada = null;
      if (!f) return;
      estado.textContent = 'Leyendo el archivo…';
      try {
        const XLSX = await cargarSheetJS();
        const buf = await f.arrayBuffer();
        const e = parseEmision(buf, XLSX);
        parseada = { ...e, archivo: f.name };
        estado.textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`;
        previa.appendChild(vistaPrevia(parseada));
      } catch (err) {
        estado.textContent = 'No se pudo leer: ' + err.message;
        estado.style.color = 'var(--danger)';
      }
    });

    await modal({
      title: 'Importar emisión del IMSS',
      size: 'lg',
      body: h('div', {}, [
        h('p', { class: 'muted', style: { fontSize: '12px', marginTop: 0 } },
          'Es el "Desglose de trabajadores" que manda el despacho: el mismo que genera la línea de captura SIPARE. Al importarlo, el módulo usa esas cifras exactas en vez de la estimación.'),
        h('div', { class: 'field' }, [h('label', {}, 'Archivo (.xls / .xlsx)'), archivo]),
        estado,
        previa
      ]),
      confirmLabel: 'Importar',
      onConfirm: async () => {
        if (!parseada) { toast('Primero elige un archivo válido', 'warn'); return false; }
        if (parseada.mes && parseada.mes !== mesSel) {
          const ok = await modal({
            title: 'El mes no coincide',
            body: `La emisión es de ${mesLabel(parseada.mes)} y estás viendo ${mesLabel(mesSel)}. ¿Cambio al mes de la emisión?`,
            confirmLabel: 'Sí, ir a ' + mesLabel(parseada.mes)
          });
          if (!ok) return false;
          mesSel = parseada.mes;
          mesInput.value = mesSel;
        }
        try {
          const guardada = {
            ...parseada,
            importadoAt: Date.now(),
            importadoPor: state.user?.uid || null
          };
          await updateCargaSocialMes(mesSel, { emision: guardada });
          toast('Emisión importada', 'ok');
          await recargarMes();
          return true;
        } catch (err) { toast('Error: ' + err.message, 'danger'); return false; }
      }
    });
  }

  function vistaPrevia(e) {
    const dato = (l, v) => h('div', { class: 'kpi' }, [
      h('span', { class: 'kpi-label' }, l), h('span', { class: 'kpi-value' }, v)
    ]);
    const sinEmparejar = emparejar(e.trabajadores || [], empById).filter((t) => !t.empleadoId);
    return h('div', {}, [
      h('div', { class: 'kpi-row' }, [
        dato('Período', e.mes ? mesLabel(e.mes) : (e.meta.periodoTexto || '—')),
        dato('Cotizantes', num0(e.trabajadores.length)),
        dato('IMSS', money(e.totalIMSS)),
        dato('RCV + INFONAVIT', money(e.totalRCV)),
        dato('Total SIPARE', money(e.totalSipare))
      ]),
      h('p', { class: 'muted', style: { fontSize: '11px', margin: '8px 0 0' } },
        `Registro patronal ${e.meta.registroPatronal || '—'} · propuesta IMSS ${e.meta.propuestaIMSS || '—'} · prima RT ${e.meta.primaRT || '—'}% · ${num0(e.meta.diasEmision)} días cotizados`),
      e.advertencias.length
        ? h('div', { class: 'readonly-banner', style: { marginTop: '10px', background: 'rgba(245,196,81,.08)', borderColor: 'rgba(245,196,81,.35)' } }, [
            h('span', { class: 'tag warn' }, 'Revisar'),
            h('span', {}, e.advertencias.join(' '))
          ])
        : null,
      sinEmparejar.length
        ? h('div', { class: 'readonly-banner', style: { marginTop: '10px', background: 'rgba(245,196,81,.08)', borderColor: 'rgba(245,196,81,.35)' } }, [
            h('span', { class: 'tag warn' }, `${sinEmparejar.length} sin emparejar`),
            h('span', {}, `No se encontró en el catálogo: ${sinEmparejar.map((t) => `${t.nombre} (NSS ${t.nss})`).join(', ')}. Captura el NSS en su ficha para que empaten.`)
          ])
        : null
    ]);
  }

  async function quitarEmision() {
    const ok = await modal({
      title: 'Quitar la emisión importada',
      body: `Se borrará la emisión de ${mesLabel(mesSel)} y el módulo volverá a la estimación calculada. Los movimientos ya enviados al buzón no se tocan.`,
      confirmLabel: 'Quitar', danger: true
    });
    if (!ok) return;
    try {
      await updateCargaSocialMes(mesSel, { emision: null });
      toast('Emisión quitada', 'ok');
      await recargarMes();
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  }

  /** Conciliación estimado (app) vs emisión oficial, por concepto. */
  function tarjetaConciliacion(t) {
    if (!emision) return null;
    const r = emision.resumen;
    const conBimestre = cierraBimestre(mesSel);
    const filasComp = [
      ['IMSS (mensual)', t.imss, emision.totalIMSS],
      ['Retiro', t.retiro, r.rcv.retiro],
      ['CEAV', t.ceav, r.rcv.ceavPatron + r.rcv.ceavObrero],
      ['INFONAVIT', t.infonavit, r.rcv.infonavit],
      ['Total SIPARE', t.sipare, emision.totalSipare]
    ].filter(([, , of]) => conBimestre || of > 0 || true);

    return h('div', { class: 'card' }, [
      h('h3', {}, 'Conciliación · estimado vs emisión'),
      h('table', { class: 'tbl' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', {}, 'Concepto'),
          h('th', { class: 'num' }, 'Estimado (app)'),
          h('th', { class: 'num' }, 'Emisión (IMSS)'),
          h('th', { class: 'num' }, 'Diferencia')
        ])]),
        h('tbody', {}, filasComp.map(([label, est, ofi], i) => {
          const d = ofi - est;
          const grande = Math.abs(d) > Math.max(1, ofi * 0.01);
          return h('tr', { style: i === filasComp.length - 1 ? { fontWeight: '600' } : {} }, [
            h('td', {}, label),
            h('td', { class: 'num muted' }, money(est)),
            h('td', { class: 'num' }, money(ofi)),
            h('td', { class: 'num' }, h('span', { style: { color: grande ? 'var(--warn)' : 'var(--text-2)' } },
              (d >= 0 ? '+' : '') + money(d)))
          ]);
        }))
      ]),
      h('p', { class: 'muted', style: { fontSize: '11px', margin: '10px 0 0' } },
        'La estimación usa el SDI y los días de la ficha de cada empleado; la emisión usa los movimientos que el despacho dio de alta ante el IMSS. Las diferencias suelen venir de altas, bajas o modificaciones de salario que la app todavía no tiene.')
    ]);
  }

  function tablaOficial() {
    const lista = emisionEmparejada();
    const conBim = emision.incluyeBimestral;
    return h('div', { class: 'card', style: { padding: 0, overflow: 'auto' } }, [
      h('table', { class: 'tbl' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', {}, 'Trabajador (emisión)'),
          h('th', {}, 'Clasificación'),
          h('th', { class: 'num' }, 'SBC'),
          h('th', { class: 'num' }, 'Días'),
          h('th', { class: 'num sep-l' }, 'IMSS'),
          h('th', { class: 'num' }, conBim ? 'RCV + INFO' : 'RCV + INFO'),
          h('th', { class: 'num' }, 'Total'),
          h('th', { class: 'num' }, 'Patrón'),
          h('th', { class: 'num' }, 'Obrero'),
          h('th', { class: 'num' }, 'Estimado app')
        ])]),
        h('tbody', {}, lista.map((t) => {
          const dif = t.estimado != null ? t.total - t.estimado : null;
          return h('tr', {}, [
            h('td', {}, [
              h('b', {}, t.nombre),
              h('div', { class: 'mono muted', style: { fontSize: '10px' } }, 'NSS ' + t.nss),
              t.empleadoId
                ? (t.via === 'nombre' ? h('span', { class: 'tag', style: { fontSize: '9px' } }, 'empatado por nombre') : null)
                : h('span', { class: 'tag warn', style: { fontSize: '9px' } }, 'sin emparejar')
            ]),
            h('td', {}, t.clasif
              ? h('span', { class: 'tag ' + (t.clasif.clasificacion === 'directo' ? 'ok' : t.clasif.ambito === 'campo' ? 'warn' : '') }, t.clasif.label)
              : h('span', { class: 'muted' }, '—')),
            h('td', { class: 'num muted' }, money(t.sbc)),
            h('td', { class: 'num' }, num0(t.diasEMA)),
            h('td', { class: 'num sep-l' }, money(t.imss)),
            h('td', { class: 'num' }, conBim ? money(t.bimestral) : h('span', { class: 'muted' }, '—')),
            h('td', { class: 'neto' }, money(t.total)),
            h('td', { class: 'num muted' }, money(t.patron)),
            h('td', { class: 'num muted' }, money(t.obrero)),
            h('td', { class: 'num muted' }, t.estimado != null
              ? h('span', { title: `Diferencia ${money(dif)}` }, money(t.estimado))
              : '—')
          ]);
        }))
      ])
    ]);
  }

  // ===== Envío al buzón =====

  /**
   * Buckets con las cifras EXACTAS de la emisión. La cuota obrera retenida no
   * se prorratea distinto: se reparte el total igual que en el modo estimado
   * (ver BASE_PRORRATEO).
   */
  function construirBucketsOficiales() {
    const lista = emisionEmparejada();
    const sinEmparejar = lista.filter((t) => !t.empleadoId);
    if (sinEmparejar.length) {
      return { error: sinEmparejar };
    }
    const buckets = {};
    for (const t of lista) {
      const monto = BASE_PRORRATEO === 'sipare' ? t.total : t.patron;
      if (monto <= 0) continue;
      const c = t.clasif;
      const key = c.clasificacion + '|' + (c.ambito || '');
      if (!buckets[key]) {
        buckets[key] = {
          clasificacion: c.clasificacion, ambito: c.ambito, label: c.label,
          importe: 0, sipare: 0, retenido: 0, costoPatronal: 0,
          imss: 0, retiro: 0, ceav: 0, infonavit: 0,
          porObra: {}, sinObra: 0, empleados: []
        };
      }
      const b = buckets[key];
      const retenido = t.art36 ? 0 : t.obrero;
      b.importe += monto;
      b.sipare += t.total;
      b.retenido += retenido;
      b.costoPatronal += t.total - retenido;
      b.imss += t.imss; b.retiro += t.retiro; b.ceav += t.ceav; b.infonavit += t.infonavit;
      b.empleados.push({
        empleadoId: t.empleadoId, nombre: t.nombre, nss: t.nss,
        sbc: t.sbc, diasCotizados: t.diasEMA,
        imss: t.imss, retiro: t.retiro, ceav: t.ceav, infonavit: t.infonavit,
        totalSipare: t.total, cuotaRetenida: round2(retenido),
        costoPatronal: round2(t.total - retenido), art36: t.art36
      });
      const oa = t.obrasAsignadas || {};
      const ids = Object.keys(oa);
      if (ids.length === 0) { b.sinObra += monto; continue; }
      const sp = ids.reduce((s, id) => s + (Number(oa[id]?.peso) || 0), 0);
      for (const id of ids) {
        const peso = Number(oa[id]?.peso) || 0;
        const frac = sp > 0 ? peso / sp : 1 / ids.length;
        b.porObra[id] = (b.porObra[id] || 0) + monto * frac;
      }
    }
    return { buckets: Object.values(buckets) };
  }

  function construirBuckets() {
    const buckets = {};
    for (const f of filas) {
      const monto = BASE_PRORRATEO === 'sipare' ? f.cuotas.totalSipare : f.cuotas.costoPatronal;
      if (monto <= 0) continue;
      const c = f.clasif;
      const key = c.clasificacion + '|' + (c.ambito || '');
      if (!buckets[key]) {
        buckets[key] = {
          clasificacion: c.clasificacion, ambito: c.ambito, label: c.label,
          importe: 0, sipare: 0, retenido: 0, costoPatronal: 0,
          imss: 0, retiro: 0, ceav: 0, infonavit: 0,
          porObra: {}, sinObra: 0, empleados: []
        };
      }
      const b = buckets[key];
      b.importe += monto;
      b.sipare += f.cuotas.totalSipare;
      b.retenido += f.cuotas.cuotaRetenida;
      b.costoPatronal += f.cuotas.costoPatronal;
      b.imss += f.cuotas.imss; b.retiro += f.cuotas.retiro;
      b.ceav += f.cuotas.ceav; b.infonavit += f.cuotas.infonavit;
      b.empleados.push({
        empleadoId: f.id, nombre: f.nombre,
        sbc: round2(f.cuotas.sbc), diasCotizados: f.dMes.cotizados,
        imss: round2(f.cuotas.imss),
        retiro: round2(f.cuotas.retiro), ceav: round2(f.cuotas.ceav), infonavit: round2(f.cuotas.infonavit),
        totalSipare: round2(f.cuotas.totalSipare),
        cuotaRetenida: round2(f.cuotas.cuotaRetenida),
        costoPatronal: round2(f.cuotas.costoPatronal),
        art36: f.cuotas.art36
      });
      const oa = f.obrasAsignadas || {};
      const ids = Object.keys(oa);
      if (ids.length === 0) { b.sinObra += monto; continue; }
      const sp = ids.reduce((s, id) => s + (Number(oa[id]?.peso) || 0), 0);
      for (const id of ids) {
        const peso = Number(oa[id]?.peso) || 0;
        const frac = sp > 0 ? peso / sp : 1 / ids.length;
        b.porObra[id] = (b.porObra[id] || 0) + monto * frac;
      }
    }
    return Object.values(buckets);
  }

  const enviarBtn = h('button', { class: 'btn primary', onClick: enviarAlBuzon }, 'Enviar al buzón');
  const quitarBtn = h('button', { class: 'btn ghost', onClick: quitarDelBuzon }, 'Quitar del buzón');
  const guardarBtn = h('button', {
    class: 'btn',
    onClick: async () => {
      guardarBtn.disabled = true;
      try { await guardarAusencias(); toast('Ausencias guardadas', 'ok'); }
      catch (err) { toast('Error: ' + err.message, 'danger'); }
      guardarBtn.disabled = false;
    }
  }, 'Guardar ausencias');

  async function guardarAusencias() {
    const limpio = {};
    for (const [id, v] of Object.entries(ausencias)) if (Number(v) > 0) limpio[id] = Number(v);
    await updateCargaSocialMes(mesSel, { ausencias: limpio });
  }

  async function enviarAlBuzon() {
    const oficial = modo === 'oficial' && !!emision;
    const conBimestre = oficial ? emision.incluyeBimestral : cierraBimestre(mesSel);

    let buckets;
    if (oficial) {
      const r = construirBucketsOficiales();
      if (r.error) {
        await modal({
          title: 'Faltan trabajadores por emparejar',
          body: h('div', {}, [
            h('p', {}, 'La emisión trae trabajadores que no están en el catálogo de empleados. Sin emparejarlos no se puede saber su clasificación contable ni a qué obra prorratear.'),
            h('ul', {}, r.error.map((t) => h('li', {}, `${t.nombre} — NSS ${t.nss}`))),
            h('p', { class: 'muted', style: { fontSize: '12px' } },
              'Captura el NSS en la ficha de cada uno (Empleados → NSS) y vuelve a intentar. También empatan por nombre completo.')
          ]),
          confirmLabel: 'Entendido'
        });
        return;
      }
      buckets = r.buckets;
    } else {
      buckets = construirBuckets();
    }
    if (buckets.length === 0) { toast('No hay cuotas que enviar este mes', 'warn'); return; }

    const venc = vencimientoCuotas(mesSel);
    const t = oficial
      ? {
          imss: emision.totalIMSS,
          retiro: emision.resumen.rcv.retiro,
          ceav: emision.resumen.rcv.ceavPatron + emision.resumen.rcv.ceavObrero,
          infonavit: emision.resumen.rcv.infonavit,
          sipare: round2(buckets.reduce((s, b) => s + b.sipare, 0)),
          retenido: round2(buckets.reduce((s, b) => s + b.retenido, 0)),
          costoPatronal: round2(buckets.reduce((s, b) => s + b.costoPatronal, 0))
        }
      : totales();

    const ok = await modal({
      title: oficial ? 'Enviar la emisión oficial al buzón' : 'Enviar carga social (estimada) al buzón',
      body: h('div', {}, [
        oficial
          ? h('div', { class: 'readonly-banner', style: { marginBottom: '10px' } }, [
              h('span', { class: 'tag ok' }, 'Emisión oficial'),
              h('span', {}, `Cifras exactas del desglose del despacho (propuesta IMSS ${emision.meta.propuestaIMSS || '—'}). Es el monto de la línea de captura SIPARE.`)
            ])
          : h('div', { class: 'readonly-banner', style: { marginBottom: '10px', background: 'rgba(245,196,81,.08)', borderColor: 'rgba(245,196,81,.35)' } }, [
              h('span', { class: 'tag warn' }, 'Estimado'),
              h('span', {}, 'Son cuotas calculadas por la app, no la emisión del IMSS. Si ya tienes el archivo del despacho, impórtalo antes de enviar.')
            ]),
        h('p', {}, `Se enviarán ${buckets.length} movimiento(s) de ${mesLabel(mesSel)} al buzón de contabilidad, separados por clasificación contable (${buckets.map(b => b.label).join(', ')}).`),
        h('div', { class: 'tipo-breakdown' }, [
          h('div', { class: 'tipo-row', style: { gridTemplateColumns: '1fr auto' } }, [
            h('div', { class: 'muted' }, 'Total SIPARE'), h('div', { class: 'tipo-val' }, h('b', {}, money(t.sipare)))
          ]),
          h('div', { class: 'tipo-row', style: { gridTemplateColumns: '1fr auto' } }, [
            h('div', { class: 'muted' }, 'Del cual, retenido en nómina'), h('div', { class: 'tipo-val' }, h('b', {}, money(t.retenido)))
          ]),
          h('div', { class: 'tipo-row', style: { gridTemplateColumns: '1fr auto' } }, [
            h('div', { class: 'muted' }, 'Costo patronal'), h('div', { class: 'tipo-val' }, h('b', {}, money(t.costoPatronal)))
          ])
        ]),
        h('p', { class: 'muted', style: { fontSize: '12px' } },
          `Vence el ${dateMx(venc)}. ${conBimestre ? 'Incluye IMSS mensual + Retiro, CEAV e INFONAVIT del bimestre.' : 'Solo IMSS mensual.'}`)
      ]),
      confirmLabel: 'Enviar'
    });
    if (!ok) return;

    enviarBtn.disabled = true; enviarBtn.innerHTML = '<span class="spinner"></span> Enviando…';
    try {
      await guardarAusencias();
      const ids = [];
      for (const b of buckets) {
        const porObra = {};
        const proyectoPorObra = {};
        for (const k of Object.keys(b.porObra)) {
          porObra[k] = round2(b.porObra[k]);
          proyectoPorObra[k] = await getProyectoIdByObraId(k).catch(() => null);
        }
        const item = {
          tipo: 'carga_social', origenApp: 'indirectos', estado: 'recibido',
          creadoPor: state.user?.uid || null,
          concepto: `Carga social ${mesLabel(mesSel)} · ${b.label}${conBimestre ? ' (IMSS + RCV/INFONAVIT)' : ' (IMSS)'}${oficial ? ' · emisión IMSS' : ' · estimado'}`,
          fecha: `${mesSel}-01`,
          fechaVencimiento: venc,
          monto: { subtotal: round2(b.importe), iva: 0, importe: round2(b.importe) },
          clasificacion: b.clasificacion, ambito: b.ambito,
          mes: mesSel,
          fuente: oficial ? 'emision_imss' : 'estimado',
          ...(oficial ? {
            registroPatronal: emision.meta.registroPatronal || null,
            propuestaIMSS: emision.meta.propuestaIMSS || null,
            propuestaRCV: emision.meta.propuestaRCV || null,
            archivoEmision: emision.archivo || null
          } : {}),
          incluyeBimestral: conBimestre,
          incluyeInfonavit: conBimestre,     // compatibilidad con lo que ya lee bitácora
          desglose: {
            imss: round2(b.imss), retiro: round2(b.retiro),
            ceav: round2(b.ceav), infonavit: round2(b.infonavit)
          },
          totalSipare: round2(b.sipare),
          cuotaRetenida: round2(b.retenido),
          costoPatronal: round2(b.costoPatronal),
          baseProrrateo: BASE_PRORRATEO,
          prorrateoPorObra: porObra, proyectoPorObra, sinObra: round2(b.sinObra),
          empleados: b.empleados
        };
        ids.push(await pushBuzonItem(item));
      }
      // update (no set) para no borrar la emisión importada.
      await updateCargaSocialMes(mesSel, {
        enviadaAt: Date.now(), buzonItemIds: ids,
        incluyeBimestral: conBimestre,
        fuente: oficial ? 'emision_imss' : 'estimado',
        ausencias: Object.fromEntries(Object.entries(ausencias).filter(([, v]) => Number(v) > 0)),
        totalSipare: round2(t.sipare), cuotaRetenida: round2(t.retenido), costoPatronal: round2(t.costoPatronal),
        enviadaPor: state.user?.uid || null
      });
      toast(`Carga social enviada (${ids.length} movimiento(s))`, 'ok');
      await refreshEnviada();
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
    enviarBtn.disabled = false; enviarBtn.textContent = 'Enviar al buzón';
  }

  async function quitarDelBuzon() {
    const rec = await getCargaSocialMes(mesSel);
    const ids = rec?.buzonItemIds || [];
    for (const id of ids) {
      let item = null;
      try { item = await getBuzonItem(id); } catch { item = null; }
      if (item && buzonEstadoActivo(item.estado)) {
        toast('Contabilidad ya aprobó/pagó esta carga social; no se puede quitar (que la rechace primero).', 'warn');
        return;
      }
    }
    const ok = await modal({
      title: 'Quitar del buzón',
      body: 'Se quitarán los movimientos de carga social de este mes. ¿Continuar?',
      confirmLabel: 'Quitar'
    });
    if (!ok) return;
    try {
      for (const id of ids) { try { await deleteBuzonItem(id); } catch { /* ignore */ } }
      await removeCargaSocialMes(mesSel);
      toast('Carga social quitada del buzón', 'ok');
      await refreshEnviada();
    } catch (err) { toast('Error: ' + err.message, 'danger'); }
  }

  async function refreshEnviada() {
    let rec = null;
    try { rec = await getCargaSocialMes(mesSel); } catch { rec = null; }
    enviadaBanner.innerHTML = '';
    if (rec?.enviadaAt) {
      enviadaBanner.appendChild(h('div', { class: 'readonly-banner' }, [
        h('span', { class: 'tag ok' }, 'Enviada'),
        h('span', {}, `Carga social de ${mesLabel(mesSel)} enviada al buzón el ${dateMx(rec.enviadaAt)} (${(rec.buzonItemIds || []).length} movimiento(s)).`)
      ]));
      enviarBtn.classList.add('hidden');
      quitarBtn.classList.remove('hidden');
    } else {
      enviarBtn.classList.remove('hidden');
      quitarBtn.classList.add('hidden');
    }
  }

  // ===== Repintado =====
  const emisionBanner = h('div', {});
  const conciliacionWrap = h('div', {});

  function pintarEmisionBanner() {
    emisionBanner.innerHTML = '';
    if (!emision) {
      emisionBanner.appendChild(h('div', { class: 'readonly-banner', style: { background: 'rgba(245,196,81,.08)', borderColor: 'rgba(245,196,81,.35)' } }, [
        h('span', { class: 'tag warn' }, 'Estimado'),
        h('span', {}, `Todavía no se importa la emisión de ${mesLabel(mesSel)}. Lo que ves es el cálculo de la app; sirve para presupuestar, pero el monto exacto a pagar sale del desglose del despacho.`),
        h('div', { style: { flex: 1 } }),
        h('button', { class: 'btn sm primary', onClick: importarEmisionDialog }, '📄 Importar emisión')
      ]));
      return;
    }
    const pill = (m, label) => h('button', {
      class: 'btn sm' + (modo === m ? ' primary' : ''),
      style: modo === m ? {} : { opacity: '.75' },
      onClick: () => { modo = m; repintar(); }
    }, label);
    emisionBanner.appendChild(h('div', { class: 'readonly-banner' }, [
      h('span', { class: 'tag ok' }, 'Emisión oficial'),
      h('span', {}, `${emision.archivo || 'Desglose del despacho'} · ${num0(emision.trabajadores.length)} cotizantes · SIPARE ${money(emision.totalSipare)} · importada el ${dateMx(emision.importadoAt)}.`),
      h('div', { style: { flex: 1 } }),
      h('div', { class: 'row', style: { gap: '6px' } }, [
        pill('oficial', 'Emisión'),
        pill('estimado', 'Estimado app'),
        h('button', { class: 'btn sm ghost danger', onClick: quitarEmision }, '✕')
      ])
    ]));
  }

  function repintar() {
    const { params, bim, conBimestre } = calcularMes();
    const tEst = totales();
    const venc = vencimientoCuotas(mesSel);
    const oficial = modo === 'oficial' && !!emision;

    bimBadge.textContent = conBimestre
      ? `Cierra bimestre ${bim.label} · IMSS + RCV + INFONAVIT`
      : 'Solo IMSS este mes';
    bimBadge.className = 'tag ' + (conBimestre ? 'accent' : 'muted');
    vencBadge.textContent = `Vence ${dateMx(venc)}`;
    vencBadge.className = 'tag';

    // En modo oficial los totales salen de la emisión.
    const t = oficial
      ? (() => {
          const lista = emisionEmparejada();
          const retenido = lista.reduce((s, x) => s + (x.art36 ? 0 : x.obrero), 0);
          const r = emision.resumen.rcv;
          return {
            conCuota: lista.length,
            imss: emision.totalIMSS,
            retiro: r.retiro, ceav: r.ceavPatron + r.ceavObrero, infonavit: r.infonavit,
            patron: emision.totalPatron, obrero: emision.totalObrero,
            sipare: emision.totalSipare,
            retenido: round2(retenido),
            costoPatronal: round2(emision.totalSipare - retenido)
          };
        })()
      : tEst;

    pintarEmisionBanner();
    pintarParametros(params);
    pintarKpis(t, oficial ? emision.incluyeBimestral : conBimestre);
    pintarDesglose(t, oficial ? emision.incluyeBimestral : conBimestre, venc, bim);

    tablaWrap.innerHTML = '';
    if (oficial) tablaWrap.appendChild(tablaOficial());
    else pintarTabla(conBimestre);

    conciliacionWrap.innerHTML = '';
    if (emision) {
      const card = tarjetaConciliacion(tEst);
      if (card) conciliacionWrap.appendChild(card);
    }

    guardarBtn.style.display = oficial ? 'none' : '';
    enviarBtn.textContent = oficial ? 'Enviar emisión al buzón' : 'Enviar estimado al buzón';
  }

  async function recargarMes() {
    let rec = null, prev = null;
    const mesPrev = mesPrevioDelBimestre(mesSel);
    try { rec = await getCargaSocialMes(mesSel); } catch { rec = null; }
    if (mesPrev) { try { prev = await getCargaSocialMes(mesPrev); } catch { prev = null; } }
    ausencias = { ...(rec?.ausencias || {}) };
    ausenciasPrevias = { ...(prev?.ausencias || {}) };
    emision = rec?.emision || null;
    modo = emision ? 'oficial' : 'estimado';
    repintar();
    await refreshEnviada();
  }

  // ===== Render =====
  renderShell(crumbs, h('div', {}, [
    h('h1', {}, 'Carga social (cuotas obrero-patronales)'),
    h('p', { class: 'muted', style: { margin: '0 0 12px' } },
      'Calculado conforme a la Ley del Seguro Social y a la Ley del INFONAVIT a partir del SBC de cada trabajador (su SDI, topado a 25 UMA) y de sus días cotizados. No hay captura manual de cuotas: lo único que se captura son los días de ausentismo e incapacidad.'),
    h('div', { class: 'row', style: { marginBottom: '16px', gap: '12px', flexWrap: 'wrap' } }, [
      h('div', { class: 'field', style: { maxWidth: '180px' } }, [h('label', {}, 'Mes'), mesInput]),
      h('div', { class: 'row', style: { gap: '6px', marginTop: '18px' } }, [bimBadge, vencBadge]),
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn', style: { marginTop: '18px' }, onClick: importarEmisionDialog }, '📄 Importar emisión')
    ]),
    emisionBanner,
    enviadaBanner,
    kpiWrap,
    h('div', { style: { marginTop: '14px' } }, paramsCard),
    h('div', { style: { marginTop: '14px' } }, tablaWrap),
    h('div', { style: { marginTop: '14px' } }, desgloseCard),
    h('div', { style: { marginTop: '14px' } }, conciliacionWrap),
    h('div', { class: 'row', style: { marginTop: '14px', justifyContent: 'flex-end' } }, [guardarBtn, quitarBtn, enviarBtn])
  ]));

  await recargarMes();
}
