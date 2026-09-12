// Lector del "Desglose de trabajadores" que emite el despacho contable: el
// archivo que produce la línea de captura SIPARE. Es la fuente EXACTA de lo que
// se va a pagar; el cálculo de js/util/imss.js sirve para estimar sin depender
// del despacho y para conciliar contra esto.
//
// El archivo trae tres hojas:
//   "Emisión {Mes} {Año}"            resumen por ramo (IMSS a la izquierda, RCV/INFONAVIT a la derecha)
//   "Movimientos EMA {Mes} {Año}"    renglón por trabajador y movimiento, cuotas MENSUALES
//   "Movimientos EBA {Mes} {Año}"    ídem, cuotas BIMESTRALES (RCV + INFONAVIT)
//
// Un trabajador puede aparecer VARIAS veces (un renglón por movimiento: alta,
// modificación de salario…); se suman sus renglones.

// SheetJS se carga bajo demanda desde CDN: solo hace falta al importar, no en
// el arranque de la app.
const SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

let cargando = null;
export function cargarSheetJS() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  if (cargando) return cargando;
  cargando = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SHEETJS_URL;
    s.async = true;
    s.onload = () => globalThis.XLSX
      ? resolve(globalThis.XLSX)
      : reject(new Error('SheetJS se cargó pero no expuso XLSX.'));
    s.onerror = () => {
      cargando = null;
      reject(new Error('No se pudo cargar el lector de Excel (¿sin conexión?).'));
    };
    document.head.appendChild(s);
  });
  return cargando;
}

// ===================== Normalización =====================

const ACENTOS = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, (ch) => ACENTOS[ch] || ch)
    .replace(/[.:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const numero = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!s || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');

const MESES_NOMBRE = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

/** "8/2026" → "2026-08". También acepta "Agosto 2026" del nombre de la hoja. */
export function mesISODe(periodoTexto, nombreHoja = '') {
  const t = texto(periodoTexto);
  const m1 = /^(\d{1,2})\s*\/\s*(\d{4})$/.exec(t);
  if (m1) return `${m1[2]}-${String(Number(m1[1])).padStart(2, '0')}`;
  const n = norm(nombreHoja);
  for (const [nombre, num] of Object.entries(MESES_NOMBRE)) {
    const m2 = new RegExp(`${nombre}\\s+(\\d{4})`).exec(n);
    if (m2) return `${m2[1]}-${String(num).padStart(2, '0')}`;
  }
  return null;
}

// ===================== Lectura de hojas =====================

const aMatriz = (XLSX, hoja) =>
  XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null, blankrows: true });

function buscarHoja(wb, prefijo) {
  const p = norm(prefijo);
  const nombre = wb.SheetNames.find((n) => norm(n).startsWith(p));
  return nombre ? { nombre, hoja: wb.Sheets[nombre] } : null;
}

/**
 * Hoja de resumen: pares etiqueta → valor de la celda de al lado. Se agrupan
 * por columna, así se distinguen los dos bloques (IMSS y RCV) aunque ambos
 * tengan un renglón "Total".
 */
function parsearResumen(matriz) {
  const pares = [];
  for (let f = 0; f < matriz.length; f++) {
    const fila = matriz[f] || [];
    for (let c = 0; c < fila.length - 1; c++) {
      const etiqueta = norm(fila[c]);
      if (!etiqueta || etiqueta.length < 3) continue;
      const valor = fila[c + 1];
      if (valor === null || valor === undefined || valor === '') continue;
      pares.push({ etiqueta, valor, col: c });
    }
  }
  const colDe = (etq) => pares.find((p) => p.etiqueta === etq)?.col ?? null;
  const colIMSS = colDe('cuota fija');
  const colRCV = colDe('suma rcv') ?? colDe('retiro');

  const mapa = (col) => {
    const m = {};
    for (const p of pares) if (p.col === col) m[p.etiqueta] = p.valor;
    return m;
  };
  return { imss: mapa(colIMSS), rcv: mapa(colRCV), pares };
}

/** Localiza el renglón de encabezados (el que trae "NSS") y mapea columnas. */
function parsearMovimientos(matriz, columnas) {
  const iCab = matriz.findIndex((f) => (f || []).some((c) => norm(c) === 'nss'));
  if (iCab < 0) return { filas: [], faltantes: Object.keys(columnas) };

  const cab = (matriz[iCab] || []).map(norm);
  const idx = {};
  const faltantes = [];
  for (const [clave, etiqueta] of Object.entries(columnas)) {
    const i = cab.indexOf(norm(etiqueta));
    if (i < 0) faltantes.push(etiqueta); else idx[clave] = i;
  }

  const filas = [];
  for (let f = iCab + 1; f < matriz.length; f++) {
    const fila = matriz[f] || [];
    const nss = soloDigitos(fila[idx.nss]);
    if (!nss) continue;
    const o = { nss, nombre: texto(fila[idx.nombre]) };
    for (const clave of Object.keys(idx)) {
      if (clave === 'nss' || clave === 'nombre') continue;
      if (clave === 'fecha') { o.fecha = texto(fila[idx.fecha]); continue; }
      o[clave] = numero(fila[idx[clave]]);
    }
    filas.push(o);
  }
  return { filas, faltantes };
}

const COLS_EMA = {
  nss: 'NSS', nombre: 'Nombre', fecha: 'Fecha del Movimiento', dias: 'Días',
  salarioDiario: 'Salario Diario',
  cuotaFija: 'Cuota Fija',
  excedentePatron: 'Excedente Patronal', excedenteObrero: 'Excedente Obrero',
  dineroPatron: 'Prestaciones en Dinero Patronal', dineroObrero: 'Prestaciones en Dinero Obrero',
  gmpPatron: 'Gastos Médicos y Pensionados Patronal', gmpObrero: 'Gastos Médicos y Pensionados Obrero',
  riesgosTrabajo: 'Riesgos de Trabajo',
  ivPatron: 'Invalidez y Vida Patronal', ivObrero: 'Invalidez y Vida Obrero',
  guarderias: 'Guarderías y Prestaciones Sociales',
  total: 'Total'
};

const COLS_EBA = {
  nss: 'NSS', nombre: 'Nombre', fecha: 'Fecha del Movimiento', dias: 'Días',
  salarioDiario: 'Salario Diario',
  retiro: 'Retiro',
  ceavPatron: 'Cesantía en Edad Avanzada y Vejez Patronal',
  ceavObrero: 'Cesantía en Edad Avanzada y Vejez Obrero',
  subtotalRCV: 'Subtotal RCV',
  infonavit: 'Aportación Patronal',
  amortizacion: 'Amortización',
  subtotalInfonavit: 'Subtotal Infonavit',
  total: 'Total'
};

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const suma = (arr, k) => round2(arr.reduce((s, r) => s + (Number(r[k]) || 0), 0));

// ===================== Parseo completo =====================

/**
 * Lee el archivo y devuelve la emisión estructurada.
 * @param {ArrayBuffer} buffer contenido del .xls/.xlsx
 * @param {object} XLSX instancia de SheetJS (cargarSheetJS)
 */
export function parseEmision(buffer, XLSX) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const advertencias = [];

  const hEmision = buscarHoja(wb, 'emision') || buscarHoja(wb, 'emisión');
  if (!hEmision) throw new Error('No se encontró la hoja de "Emisión". ¿Es el desglose que manda la contadora?');
  const hEMA = buscarHoja(wb, 'movimientos ema');
  const hEBA = buscarHoja(wb, 'movimientos eba');
  if (!hEMA) throw new Error('No se encontró la hoja "Movimientos EMA".');

  const resumen = parsearResumen(aMatriz(XLSX, hEmision.hoja));
  const ema = parsearMovimientos(aMatriz(XLSX, hEMA.hoja), COLS_EMA);
  const eba = hEBA ? parsearMovimientos(aMatriz(XLSX, hEBA.hoja), COLS_EBA) : { filas: [], faltantes: [] };

  if (ema.faltantes.length) advertencias.push(`Hoja EMA: no se encontraron las columnas ${ema.faltantes.join(', ')}.`);
  if (hEBA && eba.faltantes.length) advertencias.push(`Hoja EBA: no se encontraron las columnas ${eba.faltantes.join(', ')}.`);

  const periodoTexto = texto(resumen.imss['periodo mensual']);
  const mes = mesISODe(periodoTexto, hEmision.nombre);
  if (!mes) advertencias.push('No se pudo determinar el mes de la emisión; selecciónalo a mano.');

  // --- Resumen por ramo ---
  const r = {
    imss: {
      cuotaFija: numero(resumen.imss['cuota fija']),
      excedentePatron: numero(resumen.imss['excedente patronal']),
      excedenteObrero: numero(resumen.imss['excedente obrero']),
      dineroPatron: numero(resumen.imss['prestaciones en dinero patronal']),
      dineroObrero: numero(resumen.imss['prestaciones en dinero obrero']),
      gmpPatron: numero(resumen.imss['gastos medicos y pensionados patronal']),
      gmpObrero: numero(resumen.imss['gastos medicos y pensionados obrero']),
      riesgosTrabajo: numero(resumen.imss['riesgos de trabajo']),
      ivPatron: numero(resumen.imss['invalidez y vida patronal']),
      ivObrero: numero(resumen.imss['invalidez y vida obrero']),
      guarderias: numero(resumen.imss['guarderias y prestaciones sociales']),
      total: numero(resumen.imss['total'])
    },
    rcv: {
      retiro: numero(resumen.rcv['retiro']),
      ceavPatron: numero(resumen.rcv['cesantia y vejez patronal']),
      ceavObrero: numero(resumen.rcv['cesantia y vejez obrero']),
      sumaRCV: numero(resumen.rcv['suma rcv']),
      infonavit: numero(resumen.rcv['suma infonavit'] ?? resumen.rcv['total aportacion pat infonavit']),
      amortizacion: numero(resumen.rcv['amortizacion']),
      total: numero(resumen.rcv['total'])
    }
  };

  const meta = {
    periodoTexto,
    registroPatronal: texto(resumen.imss['registro patronal']),
    propuestaIMSS: texto(resumen.imss['numero de propuesta imss']),
    propuestaRCV: texto(resumen.rcv['numero de propuesta rcv']),
    diasEmision: numero(resumen.imss['dias']),
    cotizantesIMSS: numero(resumen.imss['total cotizantes imss']),
    cotizantesRCV: numero(resumen.rcv['total cotizantes rcv']),
    primaRT: numero(resumen.imss['prima de riesgos de trabajo']),
    acreditados: numero(resumen.rcv['numero de acreditados']),
    hojaEmision: hEmision.nombre
  };

  // --- Agregado por trabajador (un renglón por movimiento) ---
  const porNSS = new Map();
  const tomar = (nss, nombre) => {
    if (!porNSS.has(nss)) {
      porNSS.set(nss, {
        nss, nombre,
        diasEMA: 0, diasEBA: 0,
        salariosDiarios: [],
        emaPatron: 0, emaObrero: 0, emaTotal: 0,
        retiro: 0, ceavPatron: 0, ceavObrero: 0, infonavit: 0, amortizacion: 0, ebaTotal: 0,
        movimientos: []
      });
    }
    return porNSS.get(nss);
  };

  for (const f of ema.filas) {
    const t = tomar(f.nss, f.nombre);
    const patron = (f.cuotaFija || 0) + (f.excedentePatron || 0) + (f.dineroPatron || 0)
      + (f.gmpPatron || 0) + (f.riesgosTrabajo || 0) + (f.ivPatron || 0) + (f.guarderias || 0);
    const obrero = (f.excedenteObrero || 0) + (f.dineroObrero || 0) + (f.gmpObrero || 0) + (f.ivObrero || 0);
    t.diasEMA += f.dias || 0;
    t.emaPatron += patron;
    t.emaObrero += obrero;
    t.emaTotal += f.total || 0;
    if (f.salarioDiario) t.salariosDiarios.push(f.salarioDiario);
    t.movimientos.push({ tipo: 'EMA', fecha: f.fecha, dias: f.dias, salarioDiario: f.salarioDiario, total: f.total });
  }

  for (const f of eba.filas) {
    const t = tomar(f.nss, f.nombre);
    t.diasEBA += f.dias || 0;
    t.retiro += f.retiro || 0;
    t.ceavPatron += f.ceavPatron || 0;
    t.ceavObrero += f.ceavObrero || 0;
    t.infonavit += f.infonavit || 0;
    t.amortizacion += f.amortizacion || 0;
    t.ebaTotal += f.total || 0;
    if (f.salarioDiario) t.salariosDiarios.push(f.salarioDiario);
    t.movimientos.push({ tipo: 'EBA', fecha: f.fecha, dias: f.dias, salarioDiario: f.salarioDiario, total: f.total });
  }

  const trabajadores = [...porNSS.values()].map((t) => {
    const ebaPatron = t.retiro + t.ceavPatron + t.infonavit;
    const ebaObrero = t.ceavObrero;
    const patron = round2(t.emaPatron + ebaPatron);
    const obrero = round2(t.emaObrero + ebaObrero);
    return {
      nss: t.nss,
      nombre: t.nombre,
      diasEMA: t.diasEMA,
      diasEBA: t.diasEBA,
      sbc: t.salariosDiarios.length ? Math.max(...t.salariosDiarios) : 0,
      imss: round2(t.emaTotal),
      retiro: round2(t.retiro),
      ceav: round2(t.ceavPatron + t.ceavObrero),
      infonavit: round2(t.infonavit),
      amortizacion: round2(t.amortizacion),
      bimestral: round2(t.ebaTotal),
      patron, obrero,
      total: round2(t.emaTotal + t.ebaTotal),
      movimientos: t.movimientos
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // --- Conciliación: los renglones por trabajador deben cuadrar con el resumen ---
  const sumaEMA = suma(trabajadores, 'imss');
  const sumaEBA = suma(trabajadores, 'bimestral');
  if (r.imss.total && Math.abs(sumaEMA - r.imss.total) > 0.02) {
    advertencias.push(`Los movimientos EMA suman ${sumaEMA.toFixed(2)} pero el resumen dice ${r.imss.total.toFixed(2)}.`);
  }
  if (r.rcv.total && Math.abs(sumaEBA - r.rcv.total) > 0.02) {
    advertencias.push(`Los movimientos EBA suman ${sumaEBA.toFixed(2)} pero el resumen dice ${r.rcv.total.toFixed(2)}.`);
  }
  if (meta.diasEmision && Math.abs(suma(trabajadores, 'diasEMA') - meta.diasEmision) > 0.5) {
    advertencias.push(`Los días de los movimientos (${suma(trabajadores, 'diasEMA')}) no cuadran con los ${meta.diasEmision} del resumen.`);
  }

  const totalIMSS = r.imss.total || sumaEMA;
  const totalRCV = r.rcv.total || sumaEBA;

  return {
    mes,
    meta,
    resumen: r,
    totalIMSS: round2(totalIMSS),
    totalRCV: round2(totalRCV),
    totalSipare: round2(totalIMSS + totalRCV),
    totalPatron: suma(trabajadores, 'patron'),
    totalObrero: suma(trabajadores, 'obrero'),
    incluyeBimestral: trabajadores.some((t) => t.bimestral > 0),
    trabajadores,
    advertencias
  };
}

// ===================== Emparejado con el catálogo =====================

/**
 * Empareja los trabajadores de la emisión con los empleados de la app: primero
 * por NSS, si no por nombre normalizado (la emisión los escribe
 * "APELLIDOS NOMBRE", así que se compara por conjunto de palabras).
 */
export function emparejar(trabajadores, empleados) {
  const porNSS = new Map();
  const porPalabras = new Map();
  for (const [id, e] of Object.entries(empleados || {})) {
    const nss = soloDigitos(e.nss);
    if (nss) porNSS.set(nss, id);
    const palabras = norm(e.nombre).split(' ').filter(Boolean).sort().join(' ');
    if (palabras) porPalabras.set(palabras, id);
  }
  return trabajadores.map((t) => {
    let empleadoId = porNSS.get(t.nss) || null;
    let via = empleadoId ? 'nss' : null;
    if (!empleadoId) {
      const palabras = norm(t.nombre).split(' ').filter(Boolean).sort().join(' ');
      empleadoId = porPalabras.get(palabras) || null;
      via = empleadoId ? 'nombre' : null;
    }
    return { ...t, empleadoId, via };
  });
}
