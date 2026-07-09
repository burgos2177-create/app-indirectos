// Cálculo de antigüedad y finiquito (estimado) — se hace con el SUELDO BASE.
//
// Supuestos (ajustables): aguinaldo 15 días de ley (proporcional al año
// calendario), vacaciones según tabla LFT (reforma 2023) proporcionales al año
// de antigüedad en curso, y prima vacacional del 25%. Es un finiquito por
// separación voluntaria (sin indemnización). Estimado orientativo.

import { periodicidadDeTipo } from './format.js';

const DIA_MS = 86400000;

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
  const sd = salarioDiarioDe(empleado.tipo, empleado.sueldoBase);
  const alta = Number(empleado.fechaAlta) || Number(empleado.createdAt) || hasta;
  const diasAntig = Math.max(0, Math.floor((hasta - alta) / DIA_MS));
  const anios = diasAntig / 365;

  // Aguinaldo proporcional: 15 días × (días trabajados del año calendario / 365).
  const finDate = new Date(hasta);
  const iniAnioCal = new Date(finDate.getFullYear(), 0, 1).getTime();
  const iniAguinaldo = Math.max(iniAnioCal, alta);
  const diasAnioCal = Math.max(0, Math.floor((hasta - iniAguinaldo) / DIA_MS)) + 1;
  const diasAguinaldo = 15;
  const aguinaldo = diasAguinaldo * (Math.min(diasAnioCal, 365) / 365) * sd;

  // Vacaciones proporcionales al año de antigüedad en curso + prima vacacional 25%.
  const aniosCompletos = Math.floor(anios);
  const inicioAnioAniv = alta + aniosCompletos * 365 * DIA_MS;
  const diasEnAnioAniv = Math.max(0, Math.min(365, Math.floor((hasta - inicioAnioAniv) / DIA_MS)));
  const fracAniv = diasEnAnioAniv / 365;
  const diasVac = diasVacaciones(anios);
  const vacaciones = diasVac * fracAniv * sd;
  const primaVacacional = vacaciones * 0.25;

  const total = aguinaldo + vacaciones + primaVacacional;
  return {
    salarioDiario: sd,
    diasAntiguedad: diasAntig,
    anios,
    diasAguinaldo, aguinaldo,
    diasVacaciones: diasVac, vacaciones, primaVacacional,
    total
  };
}
