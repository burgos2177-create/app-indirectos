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
- **Fase 1 — Scaffold** ✓ login, home, admin, navegación, plumbing RTDB, calendario util. Stubs para empleados/períodos/gastos/categorías/configuración.
- **Fase 2 — Catálogo de empleados** ⏳ CRUD, asignación multi-obra con pesos, validación 100%.
- **Fase 3 — Períodos de nómina** ⏳ vista por tipo, captura de días/extras/bonos/deducciones, cierre y publicación al buzón.
- **Fase 4 — Gastos indirectos** ⏳ captura con 3 modos, selector conceptoKey, publicación al buzón.
- **Fase 5 — Admin extra** ⏳ CRUD categorías, configuración calendario.
- **Fase 6 — Cerrar ciclo en bitácora** ⏳ pendiente (`_aprobarNomina*` y `_aprobarGastoIndirecto` en `appsogrub/js/views/buzon.js`).

## Documentación de decisiones
Ver memoria del proyecto en
`C:/Users/Fernando/.claude/projects/D--apps-sogrub-app-indirectos/memory/`.
