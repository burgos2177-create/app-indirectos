// Cálculo de cuotas obrero-patronales conforme a la Ley del Seguro Social y a
// la Ley del INFONAVIT. Funciones puras, sin DOM: la vista solo las consume.
//
// Todo parte del SBC (= SDI del trabajador, topado a 25 UMA) y de los DÍAS
// COTIZADOS del período. No hay captura manual de cuotas.
//
// Fuera de alcance (ganchos dejados en el modelo, sin calcular): amortización
// de crédito INFONAVIT, subsidio al empleo, ISR de nómina, impuesto estatal
// sobre nóminas, prima de RT variable por siniestralidad y capitales
// constitutivos.

const DIA_MS = 86400000;

// ===================== Parámetros con vigencia =====================
//
// La UMA cambia cada 1 de febrero; el salario mínimo cada 1 de enero; la prima
// de riesgo de trabajo cada 1 de marzo (la declarada en febrero). Por eso son
// una tabla con fecha de vigencia y no constantes sueltas.
//
// SOGRUB es Clase V → prima media 7.58875%. Sustituir por la prima declarada
// en cuanto exista una determinada por siniestralidad.
export const PARAMETROS = [
  { desde: '2025-01-01', umaDiaria: 108.57, salarioMinimo: 278.80, primaRT: 0.0758875, nota: 'UMA 2024 vigente hasta 31-ene-2025' },
  { desde: '2025-02-01', umaDiaria: 113.14, salarioMinimo: 278.80, primaRT: 0.0758875, nota: 'UMA vigente 01-feb-2025 a 31-ene-2026' },
  { desde: '2026-01-01', umaDiaria: 113.14, salarioMinimo: 315.04, primaRT: 0.0758875, nota: 'Salario mínimo 2026; UMA aún la de 2025' },
  { desde: '2026-02-01', umaDiaria: 117.31, salarioMinimo: 315.04, primaRT: 0.0758875, nota: 'UMA vigente 01-feb-2026 a 31-ene-2027' }
];

/** Parámetros vigentes en una fecha 'YYYY-MM-DD' (o 'YYYY-MM', que toma el día 1). */
export function parametrosVigentes(fechaISO) {
  const f = (fechaISO || '').length === 7 ? `${fechaISO}-01` : String(fechaISO || '');
  let vig = PARAMETROS[0];
  for (const p of PARAMETROS) if (p.desde <= f) vig = p;
  return {
    ...vig,
    topeSBC: 25 * vig.umaDiaria,
    tresUMA: 3 * vig.umaDiaria
  };
}

// ===================== Tablas de tasas =====================

/**
 * Cuotas MENSUALES. `base`:
 *   'uma'        → UMA diaria (cuota fija de EyM)
 *   'excedente'  → (SBC − 3 UMA), solo si SBC > 3 UMA
 *   'sbc'        → SBC
 *   'rt'         → SBC, con la prima de riesgo vigente
 * Cada renglón se multiplica por los días cotizados del mes.
 */
export const RAMOS_MENSUALES = [
  { key: 'eym_fija',      label: 'EyM cuota fija',                    base: 'uma',       patron: 0.2040, obrero: 0 },
  { key: 'eym_excedente', label: 'EyM excedente (sobre 3 UMA)',       base: 'excedente', patron: 0.0110, obrero: 0.00400 },
  { key: 'eym_dinero',    label: 'EyM prestaciones en dinero',        base: 'sbc',       patron: 0.0070, obrero: 0.00250 },
  { key: 'eym_gmp',       label: 'EyM gastos médicos pensionados',    base: 'sbc',       patron: 0.0105, obrero: 0.00375 },
  { key: 'iv',            label: 'Invalidez y Vida',                  base: 'sbc',       patron: 0.0175, obrero: 0.00625 },
  { key: 'guarderias',    label: 'Guarderías y prestaciones sociales', base: 'sbc',      patron: 0.0100, obrero: 0 },
  { key: 'rt',            label: 'Riesgos de Trabajo',                base: 'rt',        patron: null,   obrero: 0 }
];

/** Cuotas BIMESTRALES (base: días cotizados del bimestre completo). */
export const RAMOS_BIMESTRALES = [
  { key: 'retiro',    label: 'Retiro',                    base: 'sbc', patron: 0.0200, obrero: 0 },
  { key: 'ceav',      label: 'Cesantía en Edad Avanzada y Vejez', base: 'sbc', patron: null, obrero: 0.01125 },
  { key: 'infonavit', label: 'INFONAVIT',                 base: 'sbc', patron: 0.0500, obrero: 0 }
];

/**
 * CEAV patronal: progresiva según el SBC expresado en UMA (cuarto ajuste del
 * decreto DOF 16-dic-2020; sube cada año hasta 2030).
 *
 * El renglón "1.00 SM = 3.150%" del decreto no aplica en la práctica: el SBC
 * integrado de un trabajador de salario mínimo ya rebasa un salario mínimo.
 */
export const TABLA_CEAV = [
  { hastaUMA: 1.50,     patron: 0.03676 },
  { hastaUMA: 2.00,     patron: 0.04851 },
  { hastaUMA: 2.50,     patron: 0.05556 },
  { hastaUMA: 3.00,     patron: 0.06026 },
  { hastaUMA: 3.50,     patron: 0.06361 },
  { hastaUMA: 4.00,     patron: 0.06613 },
  { hastaUMA: Infinity, patron: 0.07513 }
];

export function tasaCEAVPatronal(sbc, umaDiaria) {
  const enUMA = umaDiaria > 0 ? sbc / umaDiaria : 0;
  for (const t of TABLA_CEAV) if (enUMA <= t.hastaUMA) return t.patron;
  return TABLA_CEAV[TABLA_CEAV.length - 1].patron;
}

// ===================== Redondeo =====================
//
// El SUA redondea cada ramo por trabajador a dos decimales; hacerlo igual evita
// diferencias de centavos contra la emisión del IMSS. Cambiando esta constante
// a 'total' se acumula a precisión completa y solo se redondea al presentar
// (útil para cuadrar contra una hoja de cálculo).
export const MODO_REDONDEO = 'ramo';

export const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const redondeaRamo = (n, modo) => (modo === 'ramo' ? round2(n) : Number(n) || 0);

// ===================== Fechas y días cotizados =====================

const diaLocal = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const diasInclusive = (desdeMs, hastaMs) =>
  Math.max(0, Math.round((diaLocal(hastaMs) - diaLocal(desdeMs)) / DIA_MS) + 1);

export const inicioMes = (mesISO) => {
  const [y, m] = String(mesISO).split('-').map(Number);
  return new Date(y, m - 1, 1).getTime();
};
export const finMes = (mesISO) => {
  const [y, m] = String(mesISO).split('-').map(Number);
  return new Date(y, m, 0).getTime();    // día 0 del mes siguiente = último del mes
};
export const mesNumero = (mesISO) => Number(String(mesISO).split('-')[1]) || 1;

/** El bimestre cierra en los meses pares: ene-feb, mar-abr, …, nov-dic. */
export const cierraBimestre = (mesISO) => mesNumero(mesISO) % 2 === 0;

/** Rango [inicio, fin] del bimestre que contiene al mes. */
export function rangoBimestre(mesISO) {
  const [y, m] = String(mesISO).split('-').map(Number);
  const primero = m % 2 === 0 ? m - 1 : m;       // mes impar del par
  const iso = (mm) => `${y}-${String(mm).padStart(2, '0')}`;
  return { inicio: inicioMes(iso(primero)), fin: finMes(iso(primero + 1)), label: `${iso(primero)} / ${iso(primero + 1)}` };
}

/**
 * DÍAS COTIZADOS: días NATURALES entre alta y baja dentro del rango, inclusive
 * (domingos y festivos incluidos), menos ausentismos e incapacidades. No son
 * días trabajados ni días de nómina.
 */
export function diasCotizados(empleado, desdeMs, hastaMs, ausencias = 0) {
  const alta = Number(empleado?.fechaAlta) || Number(empleado?.createdAt) || 0;
  const baja = Number(empleado?.fechaBaja) || 0;
  const desde = alta ? Math.max(desdeMs, alta) : desdeMs;
  const hasta = baja ? Math.min(hastaMs, baja) : hastaMs;
  if (diaLocal(hasta) < diaLocal(desde)) return { naturales: 0, ausencias: 0, cotizados: 0 };
  const naturales = diasInclusive(desde, hasta);
  const aus = Math.max(0, Math.min(naturales, Number(ausencias) || 0));
  return { naturales, ausencias: aus, cotizados: naturales - aus };
}

// ===================== Calendario de pagos =====================

const esInhabil = (d) => d.getDay() === 0 || d.getDay() === 6;

/** Día 17 del mes siguiente al período; si cae inhábil, se recorre al siguiente hábil. */
export function vencimientoCuotas(mesISO) {
  const [y, m] = String(mesISO).split('-').map(Number);
  const d = new Date(y, m, 17);          // mes+1 (Date usa índice 0)
  while (esInhabil(d)) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// ===================== Cálculo por trabajador =====================

/**
 * Cuotas de un trabajador para un mes.
 *
 * @param {object} p
 *   sbc            SBC diario ya topado (ver sbcDe)
 *   salarioDiario  salario diario base — solo para la regla del art. 36 LSS
 *   diasMes        días cotizados del mes
 *   diasBimestre   días cotizados del bimestre completo
 *   incluyeBimestral  si este mes cierra bimestre
 *   params         parámetros vigentes (parametrosVigentes)
 */
export function calcularCuotasEmpleado({
  sbc, salarioDiario, diasMes, diasBimestre, incluyeBimestral, params, modoRedondeo = MODO_REDONDEO
}) {
  const uma = params.umaDiaria;
  const excedenteDiario = Math.max(0, sbc - params.tresUMA);

  const baseDe = (tipo, dias) => {
    if (tipo === 'uma') return uma * dias;
    if (tipo === 'excedente') return excedenteDiario * dias;
    return sbc * dias;                     // 'sbc' y 'rt'
  };

  const armar = (ramos, dias) => ramos.map((r) => {
    const base = baseDe(r.base, dias);
    const tasaPatron = r.key === 'rt' ? params.primaRT
      : r.key === 'ceav' ? tasaCEAVPatronal(sbc, uma)
        : r.patron;
    return {
      key: r.key,
      label: r.label,
      tasaPatron,
      tasaObrero: r.obrero,
      base,
      patron: redondeaRamo(base * tasaPatron, modoRedondeo),
      obrero: redondeaRamo(base * r.obrero, modoRedondeo)
    };
  });

  const mensuales = armar(RAMOS_MENSUALES, diasMes);
  const bimestrales = incluyeBimestral ? armar(RAMOS_BIMESTRALES, diasBimestre) : [];

  const suma = (arr, campo) => arr.reduce((s, r) => s + r[campo], 0);
  const mensualPatron = suma(mensuales, 'patron');
  const mensualObrero = suma(mensuales, 'obrero');
  const bimestralPatron = suma(bimestrales, 'patron');
  const bimestralObrero = suma(bimestrales, 'obrero');

  const totalPatron = mensualPatron + bimestralPatron;
  const totalObrero = mensualObrero + bimestralObrero;
  const totalSipare = totalPatron + totalObrero;

  // Art. 36 LSS: con salario mínimo, la cuota obrera la paga íntegra el patrón.
  // No se retiene nada al trabajador, pero el importe SÍ es costo patronal.
  const art36 = salarioDiario > 0 && salarioDiario <= params.salarioMinimo + 0.005;
  const cuotaRetenida = art36 ? 0 : totalObrero;
  const costoPatronal = totalSipare - cuotaRetenida;

  // Desglose por destino de pago (el SIPARE los separa así).
  const porRamo = (arr, key) => arr.find((r) => r.key === key) || { patron: 0, obrero: 0 };
  const retiro = porRamo(bimestrales, 'retiro');
  const ceav = porRamo(bimestrales, 'ceav');
  const infonavit = porRamo(bimestrales, 'infonavit');

  return {
    sbc, sbcEnUMA: uma > 0 ? sbc / uma : 0, salarioDiario, art36,
    diasMes, diasBimestre, incluyeBimestral,
    mensuales, bimestrales,
    mensualPatron, mensualObrero,
    bimestralPatron, bimestralObrero,
    totalPatron, totalObrero, totalSipare,
    cuotaRetenida, costoPatronal,
    imss: mensualPatron + mensualObrero,
    retiro: retiro.patron + retiro.obrero,
    ceav: ceav.patron + ceav.obrero,
    infonavit: infonavit.patron + infonavit.obrero,
    tasaCEAV: incluyeBimestral ? tasaCEAVPatronal(sbc, uma) : null
  };
}

/**
 * SBC del trabajador = SDI topado a 25 UMA.
 *
 * El SDI se toma del registrado en la ficha; si no hay, se estima integrando el
 * sueldo base (misma regla que el cálculo de finiquito), y se marca como
 * estimado para que se vea en pantalla.
 */
export function sbcDe(empleado, params, { sdi, factorIntegracion }) {
  const bruto = Number(sdi) || 0;
  const topado = Math.min(bruto, params.topeSBC);
  return {
    sbc: topado,
    sdi: bruto,
    topeAplicado: bruto > params.topeSBC,
    registrado: Number(empleado?.sdi) > 0,
    salarioDiario: factorIntegracion > 0 ? topado / factorIntegracion : topado
  };
}
