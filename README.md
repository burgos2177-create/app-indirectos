# App Indirectos SGR

App web del **auxiliar administrativo** de SOGRUB. Quinta pieza de la suite
`sogrub-suite`. Aquí se planifican las **nóminas** del personal técnico,
administrativo y operativo y los **gastos indirectos** (oficina, gasolina,
servicios, etc.) que después se cobran en bitácora.

Parte de la suite **sogrub-suite** (Firebase compartido con app-estimaciones,
app-materiales, app-compras y appsogrub/Bitácora).

## Stack
- Vanilla JS (ES modules nativos), HTML, CSS — sin frameworks ni bundler.
- Firebase Realtime Database + Authentication (proyecto `sogrub-suite`).

## Setup local
```bash
python serve.py 8083
```
Luego abre http://localhost:8083/

(Puerto 8083 para no chocar con estimaciones 8080, materiales 8081, compras 8082.)

## Modelo

### Personal (4 tipos)
- `operativo` — albañiles, ayudantes. **Nómina semanal**, lun-vie corte viernes (configurable).
- `tecnico_campo` — residente, superintendente, auxiliar de campo. Quincenal.
- `tecnico_oficina` — ingeniero, arquitecto, contador, auxiliar. Quincenal.
- `directivo` — gerente, director. Quincenal.

Cada empleado tiene **obras asignadas con peso configurable** (suma 100%) para
prorratear su sueldo entre las obras donde participa.

### Puestos (tabulador base)
`/shared/indirectos/puestos/{id}` = `{ nombre, tipo, sueldoBase, bonos, sdi,
activo, orden }`. Es un catálogo de presets: al dar de alta un empleado se
elige el puesto y esos valores se **copian** a su ficha (tipo de personal,
sueldo base del período, bono por rendimiento y SDI). A partir de ahí el
empleado es independiente — ajustarlo no toca el preset, y editar el preset no
reescribe a quienes ya se dieron de alta. Desde la ficha se puede crear un
puesto nuevo sobre la marcha y decidir si se guarda en el catálogo.

### Cálculo de nómina
Todo se calcula aquí. El contador en bitácora **solo deposita**. Cada empleado-período:
- Sueldo base + días trabajados + horas extra + bonos + prestaciones.
- Deducciones manuales (ISR, IMSS, INFONAVIT, préstamos) con prefill del período anterior.
- Auto-cálculo de deducciones queda para v2.

### Gastos indirectos (captura suelta)
Tres modos de atribución:
- **obra_unica** → 1 `sogrub_proy_movimientos` (gasto del proyecto).
- **prorrateo_obras** (con pesos) → N `sogrub_proy_movimientos`.
- **sogrub_empresa** (sin obra) → 1 `sogrub_movimientos` (egreso Mifel).

Categorías editables: oficina, gasolina, servicios, telefonía, viáticos,
mantenimiento, otros.

## Buzón cross-app
Esta app publica:
- `nomina_operativo_semana` (semanal)
- `nomina_tecnico_campo_quincena` (quincenal)
- `nomina_tecnico_oficina_quincena` (quincenal)
- `nomina_directivo_quincena` (quincenal)
- `nomina_individual` (casos fuera de la nómina grupal)
- `gasto_indirecto`

Bitácora aprueba en `js/views/buzon.js` y genera el movimiento contable:
- Nómina: 1× `sogrub_movimientos` (Mifel) + N× `sogrub_proy_movimientos` por obra.
- Gasto según `modo`.

## Estado actual
- **Fase 1 — Scaffold** ✓ login, home, admin, navegación, plumbing RTDB, calendario util.
- **Fase 2 — Catálogo de empleados** ✓ CRUD, asignación multi-obra con pesos, validación 100%.
- **Fase 3 — Períodos de nómina** ✓ 4 carriles (operativo semanal + 3 quincenales), "Armar período actual" con prellenado del catálogo, captura editable de días/horas extra/bonos/prestaciones/deducciones con neto en vivo, cierre con publicación al buzón (prorrateo del neto por obra) y reapertura mientras contabilidad no lo procese.
- **Fase 4 — Gastos indirectos** ✓ captura con los 3 modos (obra única / prorrateo / empresa), subtotal+IVA+importe, categoría, conceptoKey y proveedor opcionales, publicación al buzón (prorrateo → N movimientos).
- **Fase 5 — Admin extra** ✓ CRUD de categorías (con semillas) y configuración del calendario semanal.
- **Fase 6 — Cerrar ciclo en bitácora** ⏳ pendiente del lado de bitácora (`_aprobarNomina*` y `_aprobarGastoIndirecto` en `appsogrub/js/views/buzon.js`).

### Contrato del buzón (contabilidad)
Cada item publicado en `/shared/buzon/{id}` sigue el envelope que consume bitácora:
```
{ tipo, origenApp:"indirectos", obraId?, concepto,
  monto:{ subtotal, iva, importe }, fecha:"YYYY-MM-DD",
  estado:"recibido", creadoPor, creadoAt,
  proveedorNombre?, conceptoKey? }
```
Gasto obra única → 1 item; prorrateo → N items (uno por obra con su porción); empresa → item sin `obraId` (`empresa:true`). La nómina reutiliza el mismo envelope (`monto.importe` = neto total, sin IVA) y agrega el desglose por empleado y `prorrateoPorObra`.

**Clasificación contable** (para conciliar presupuesto vs gasto): nóminas y carga
social incluyen `clasificacion:"directo"|"indirecto"` y `ambito:"campo"|"oficina"|null`
según el tipo de personal:
- `operativo` → **directo** (por administración: cuadrilla, rendimiento × jornal en la matriz de PU), `ambito:null`.
- `tecnico_campo` → indirecto de campo.
- `tecnico_oficina` / `directivo` → indirecto de oficina.

**Carga social** publica `tipo:"carga_social"` (IMSS mensual + INFONAVIT bimestral),
un item por bucket de clasificación, con `mes`, `incluyeInfonavit`, `fechaVencimiento`
(día 17) y `prorrateoPorObra`.

### Caja chica (fondo físico por obra)
Fondo compartido por obra en rutas absolutas `/shared/cajaChica/{obraId}` (materiales
e indirectos reportan al mismo fondo; distinguir con `origen:"indirectos"`). Reportar
un gasto escribe ATÓMICAMENTE (multi-path update en la raíz) dos nodos cruzados: el
movimiento `{tipo:"gasto", estado:"reportado", buzonItemId}` y el item de buzón
`{tipo:"gasto_caja_chica", movimientoId, monto (bruto), incluyeIva, categoriaSugerida,
ambitoSugerido, proyectoId?}`. El ciclo de estados (reportado→aprobado/rechazado) lo
maneja el contador en bitácora; indirectos solo escribe `reportado` y refleja. Saldo =
depósitos (transferencia, `estado='aprobado'` o sin estado legacy) − gastos aprobados.
Depósito opcional (`deposito_caja_chica`).

**Dos fondos por obra (2026-07-25)**: cada movimiento pertenece a un fondo — `fondo`
ausente = transferencia (histórico) o `fondo:'efectivo'` (billete físico). La vista
tiene pills 🏦/💵 (`?fondo=` en la ruta); `calcSaldo(movs, fondo)` calcula por fondo.
En el fondo efectivo el depósito nace `estado:'solicitado'`, SÍ va al buzón y al
aprobarlo el contador lo saca de la caja física de SOGRUB (no de Mifel) — entonces
suma al saldo del fondo. Gastos del fondo llevan `fondo:'efectivo'` en el movimiento
y en el item de buzón. Contrato: `appsogrub/docs/spec-caja-chica-fondo-efectivo.md`.

## Documentación de decisiones
Ver memoria del proyecto en
`C:/Users/Fernando/.claude/projects/D--apps-sogrub-app-indirectos/memory/`.
