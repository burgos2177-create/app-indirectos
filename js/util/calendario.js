// Cálculo de períodos de nómina.
//
// Operativos: semanal. Default lun-vie con corte viernes. Configurable
//   globalmente via /shared/indirectos/meta.calendarioSemanal.
// Resto: quincenal. 1-15 / 16-fin de mes. No configurable.
//
// periodoId determinista para idempotencia:
//   `operativo_${YYYY-MM-DD-fechaCorte}`
//   `quincenal_${YYYY-MM-DD-fechaCorte}`  (15 o último del mes)

const DIA_NUM = { dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6 };
const DIA_NAME_LARGO = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };

function clone(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function isoLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

// ===== Semanal (operativos) =====

// Calcula el período semanal que contiene a `refDate`.
// `calendario` = { diaInicio: 'lun', diaCorte: 'vie', diasLaborables: 5 }
export function periodoSemanal(refDate, calendario = { diaInicio: 'lun', diaCorte: 'vie' }) {
  const ref = clone(refDate);
  const inicioDow = DIA_NUM[calendario.diaInicio] ?? 1;
  const corteDow = DIA_NUM[calendario.diaCorte] ?? 5;

  // Buscar el último 'inicioDow' <= ref
  const inicio = clone(ref);
  while (inicio.getDay() !== inicioDow) inicio.setDate(inicio.getDate() - 1);

  // Corte = primer diaCorte >= inicio
  const corte = clone(inicio);
  while (corte.getDay() !== corteDow) corte.setDate(corte.getDate() + 1);

  return {
    tipo: 'operativo',
    periodicidad: 'semanal',
    fechaInicio: inicio.getTime(),
    fechaCorte: corte.getTime(),
    fechaInicioISO: isoLocal(inicio),
    fechaCorteISO: isoLocal(corte),
    periodoId: `operativo_${isoLocal(corte)}`,
    diasLaborables: calendario.diasLaborables ?? 5,
    label: `Semana del ${isoLocal(inicio)} al ${isoLocal(corte)}`
  };
}

// ===== Quincenal (resto del personal) =====

// Quincena 1: día 1 al 15. Quincena 2: día 16 al último día del mes.
export function periodoQuincenal(refDate, tipo = 'tecnico_campo') {
  const ref = clone(refDate);
  const day = ref.getDate();
  const year = ref.getFullYear();
  const month = ref.getMonth();
  let inicio, corte;
  if (day <= 15) {
    inicio = new Date(year, month, 1);
    corte = new Date(year, month, 15);
  } else {
    inicio = new Date(year, month, 16);
    corte = new Date(year, month + 1, 0); // último día del mes
  }
  const diasLaborables = Math.round((corte - inicio) / 86400000) + 1;
  return {
    tipo,
    periodicidad: 'quincenal',
    fechaInicio: inicio.getTime(),
    fechaCorte: corte.getTime(),
    fechaInicioISO: isoLocal(inicio),
    fechaCorteISO: isoLocal(corte),
    periodoId: `${tipo}_${isoLocal(corte)}`,
    diasLaborables,
    label: `${isoLocal(inicio)} al ${isoLocal(corte)}`
  };
}

// Devuelve el período actual del tipo solicitado, usando `ref` como anchor.
export function periodoActual(tipo, ref = new Date(), calendario) {
  if (tipo === 'operativo') return periodoSemanal(ref, calendario);
  return periodoQuincenal(ref, tipo);
}

// Para mostrar el calendario al admin.
export function nombreDia(diaCorto) {
  return DIA_NAME_LARGO[DIA_NUM[diaCorto]] || diaCorto;
}
