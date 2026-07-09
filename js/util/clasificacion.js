// Clasificación contable por tipo de personal, para conciliar presupuesto vs
// gasto (matrices de precios unitarios).
//
// - operativo       → COSTO DIRECTO (personal por administración: se calcula por
//                     cuadrilla, rendimiento × jornal en la matriz de PU).
// - tecnico_campo   → indirecto de CAMPO.
// - tecnico_oficina → indirecto de OFICINA.
// - directivo       → indirecto de OFICINA.
//
// La carga social (IMSS/INFONAVIT) de cada empleado hereda esta clasificación.

export const CLASIF_PERSONAL = {
  operativo:       { clasificacion: 'directo',   ambito: null,      label: 'Costo directo' },
  tecnico_campo:   { clasificacion: 'indirecto', ambito: 'campo',   label: 'Indirecto de campo' },
  tecnico_oficina: { clasificacion: 'indirecto', ambito: 'oficina', label: 'Indirecto de oficina' },
  directivo:       { clasificacion: 'indirecto', ambito: 'oficina', label: 'Indirecto de oficina' }
};

export function clasificacionDe(tipo) {
  return CLASIF_PERSONAL[tipo] || { clasificacion: 'indirecto', ambito: 'oficina', label: 'Indirecto' };
}
