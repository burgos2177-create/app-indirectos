// Cálculo de antigüedad y finiquito (estimado) — se hace con el SUELDO BASE.
//
// Supuestos (ajustables): aguinaldo 15 días de ley (proporcional al año
// calendario), vacaciones según tabla LFT (reforma 2023) proporcionales al año
// de antigüedad en curso, y prima vacacional del 25%. Es un finiquito por
// separación voluntaria (sin indemnización). Estimado orientativo.

import { periodicidadDeTipo } from './format.js';
import { parametrosVigentes } from './imss.js';

const DIA_MS = 86400000;

// El salario mínimo (para topar la prima de antigüedad a 2× mínimo) sale de la
// tabla con vigencia de js/util/imss.js — misma fuente que usa la carga social.
// Se toma el vigente a la fecha de cálculo, que es el que aplica al pago.
export const salarioMinimoEn = (fecha = Date.now()) => parametrosVigentes(fecha).salarioMinimo;
const PRIMA_VACACIONAL = 0.25;
const DIAS_AGUINALDO = 15;

// Días de vacaciones anuales según años cumplidos de antigüedad (LFT 2023).
export function diasVacaciones(anios) {
  const a = Math.floor(anios);
  if (a <= 1) return 12;
  if (a === 2) return 14;
  if (a === 3) return 16;
  if (a === 4) return 18;
  if (a === 5) return 20;
  // 6 en adelante: +2 días por cada bloque de 5 años.
  return 20 + Math.ceil((a - 5) / 5) * 2;
}

// Salario diario a partir del sueldo base (según periodicidad → mensual → /30).
export function salarioDiarioDe(tipo, sueldoBase) {
  const base = Number(sueldoBase) || 0;
  const mensual = periodicidadDeTipo(tipo) === 'semanal' ? base * 52 / 12 : base * 2;
  return mensual / 30;
}

export function calcularFiniquito(empleado, hasta = Date.now()) {
  const alta = Number(empleado.fechaAlta) || Number(empleado.createdAt) || hasta;
  const diasAntig = Math.max(0, Math.floor((hasta - alta) / DIA_MS));
  const anios = diasAntig / 365;
  const diasVac = diasVacaciones(anios);

  // === Salario diario (SD) y SDI ===
  // Factor de integración = 1 + días de aguinaldo/365 + (días vacaciones × prima)/365.
  const factorIntegracion = 1 + (DIAS_AGUINALDO / 365) + (diasVac * PRIMA_VACACIONAL / 365);
  // Si el empleado tiene un SDI registrado, se usa TAL CUAL y de él se deriva el
  // salario diario. Si no, el SDI se estima integrando el sueldo base.
  const sdiManual = Number(empleado.sdi) > 0;
  const sdi = sdiManual ? Number(empleado.sdi) : salarioDiarioDe(empleado.tipo, empleado.sueldoBase) * factorIntegracion;
  const sd = sdi / factorIntegracion;

  // === Proporcionales del finiquito (con SALARIO DIARIO) ===
  // Aguinaldo proporcional: 15 días × (días trabajados del año calendario / 365).
  const finDate = new Date(hasta);
  const iniAnioCal = new Date(finDate.getFullYear(), 0, 1).getTime();
  const iniAguinaldo = Math.max(iniAnioCal, alta);
  const diasAnioCal = Math.max(0, Math.floor((hasta - iniAguinaldo) / DIA_MS)) + 1;
  const aguinaldo = DIAS_AGUINALDO * (Math.min(diasAnioCal, 365) / 365) * sd;

  // Vacaciones proporcionales al año de antigüedad en curso + prima vacacional 25%.
  const aniosCompletos = Math.floor(anios);
  const inicioAnioAniv = alta + aniosCompletos * 365 * DIA_MS;
  const diasEnAnioAniv = Math.max(0, Math.min(365, Math.floor((hasta - inicioAnioAniv) / DIA_MS)));
  const fracAniv = diasEnAnioAniv / 365;
  const vacaciones = diasVac * fracAniv * sd;
  const primaVacacional = vacaciones * PRIMA_VACACIONAL;

  const totalFiniquito = aguinaldo + vacaciones + primaVacacional;

  // === Componentes de LIQUIDACIÓN (despido injustificado) con SDI ===
  const indemnizacion90 = 90 * sdi;                 // 3 meses constitucionales
  const veinteDias = 20 * anios * sdi;              // 20 días por año de servicio
  const salarioMinimo = salarioMinimoEn(hasta);
  const salarioTopado = Math.min(sd, 2 * salarioMinimo);
  const primaAntiguedad = 12 * anios * salarioTopado; // 12 días/año, tope 2× mínimo
  const totalLiquidacion = totalFiniquito + indemnizacion90 + veinteDias + primaAntiguedad;

  return {
    salarioDiario: sd,
    factorIntegracion, sdi, sdiManual,
    salarioMinimo, salarioTopado,
    diasAntiguedad: diasAntig, anios,
    // finiquito (voluntario, con SD)
    diasAguinaldo: DIAS_AGUINALDO, aguinaldo,
    diasVacaciones: diasVac, vacaciones, primaVacacional,
    totalFiniquito,
    // liquidación (despido, con SDI)
    indemnizacion90, veinteDias, primaAntiguedad, totalLiquidacion,
    total: totalFiniquito
  };
}
