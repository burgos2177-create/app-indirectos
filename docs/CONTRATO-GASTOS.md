# Contrato de escritura — Gasto de caja chica

Documenta **exactamente** lo que `js/services/db.js` escribe en la Realtime
Database cuando app-indirectos reporta un gasto pagado con caja chica. Es un
documento descriptivo: refleja el código tal como está, no lo que debería ser.

**Código de referencia**

| Qué | Dónde |
| --- | --- |
| Escritura atómica | `js/services/db.js` → `reportarGastoCajaChica(obraId, movBase, itemBase)` |
| Construcción del payload | `js/views/cajachica.js` → `gastoDialog()`, bloque `onConfirm` |
| Fórmula de saldo | `js/views/cajachica.js` → `calcSaldo()` |
| Borrado | `js/services/db.js` → `borrarMovimientoCajaChica()` |

---

## 1. Rutas en RTDB

Un gasto **no** es un registro: son **dos nodos escritos en una sola operación
atómica** (multi-path `update()` en la raíz), cruzados por id.

```
/shared/cajaChica/{obraId}/movimientos/{movId}   ← el movimiento del fondo
/shared/buzon/{itemId}                           ← el item que aprueba el contador
```

Ambos ids son push keys de Firebase, generadas en el cliente antes de escribir:

```js
const movId  = push(ref(db, `/shared/cajaChica/${obraId}/movimientos`)).key;
const itemId = push(ref(db, '/shared/buzon')).key;
await update(ref(db), {
  [`/shared/cajaChica/${obraId}/movimientos/${movId}`]: { ...movBase, buzonItemId: itemId },
  [`/shared/buzon/${itemId}`]:                          { ...itemBase, movimientoId: movId }
});
```

Consecuencias del diseño:

- **O se escriben los dos, o ninguno.** No existe el estado "movimiento sin item
  de buzón" ni al revés.
- Las rutas son **absolutas**, fuera del prefijo de la app. `db.js` resuelve todo
  path relativo bajo `APP_BASE_PATH = "shared/indirectos"`; un path que empieza
  con `/` se interpreta como absoluto. Caja chica y buzón son **compartidos** con
  app-materiales y app-bitácora: escriben en el mismo lugar y comparten saldo.
- El nodo `/shared/cajaChica/{obraId}` también puede tener `meta`, del que esta
  app solo lee `meta.umbralAlerta` (number, default `1000`).

---

## 2. Campos del movimiento

Ruta: `/shared/cajaChica/{obraId}/movimientos/{movId}`

| Campo | Tipo | Valores | Siempre | Origen |
| --- | --- | --- | --- | --- |
| `tipo` | string | `"gasto"` (literal fijo para este flujo) | sí | fijo en código |
| `estado` | string | nace en `"reportado"`; el contador lo pasa a `"aprobado"` o `"rechazado"` | sí | fijo en código |
| `monto` | number | > 0. **Bruto**, tal como se pagó (IVA incluido si aplica) | sí | usuario |
| `fecha` | number | epoch ms, medianoche local del día elegido | sí | usuario (default hoy) |
| `comentario` | string | concepto del gasto, no vacío (validado) | sí | usuario |
| `autor` | object | `{ uid, email, displayName }` — cada uno string o `null` | sí | sesión |
| `origen` | string | `"indirectos"` (literal). Materiales escribe `"materiales"` | sí | fijo en código |
| `createdAt` | number | epoch ms del momento de reportar | sí | fijo en código |
| `buzonItemId` | string | push key del item de buzón cruzado | sí | `db.js` |
| `fondo` | string | `"efectivo"` — **solo si** el gasto es del fondo efectivo. **Ausente** = fondo transferencia | no | UI |

`fondo` es un campo **ausente-por-defecto**, no un enum de dos valores: todo lo
histórico y todo lo del fondo transferencia simplemente no lo trae. La lectura
lo normaliza así:

```js
const fondoDeMov = (m) => (m?.fondo === 'efectivo' ? 'efectivo' : 'transferencia');
```

**Lo que el movimiento NO lleva:** `obraId` (va en la ruta), `proveedor`,
`factura`, `categoriaSugerida`, `ambitoSugerido` ni `incluyeIva`. Todo ese
detalle vive **solo en el item de buzón**. La tabla de movimientos sí lee
`m.proveedor` y `m.incluyeIva` porque los movimientos escritos por
**app-materiales** sí los traen; en los de indirectos salen vacíos.

---

## 3. Campos del item de buzón

Ruta: `/shared/buzon/{itemId}`

| Campo | Tipo | Valores | Siempre |
| --- | --- | --- | --- |
| `tipo` | string | `"gasto_caja_chica"` (literal) | sí |
| `origenApp` | string | `"indirectos"` (literal) | sí |
| `estado` | string | nace en `"recibido"`; bitácora lo mueve | sí |
| `obraId` | string | push key de la obra | sí |
| `proyectoId` | string \| null | id del proyecto contable resuelto, o `null` si la obra no está vinculada | sí (puede ser `null`) |
| `monto` | number | > 0, bruto. **Número plano, no objeto** | sí |
| `incluyeIva` | boolean | `true` = el monto trae IVA 16% incorporado; `false` = monto es subtotal | sí |
| `fecha` | number | epoch ms, misma que el movimiento | sí |
| `proveedor` | string \| null | texto libre, `null` si se dejó vacío | sí (puede ser `null`) |
| `factura` | string \| null | folio/serie, texto libre | sí (puede ser `null`) |
| `comentario` | string \| null | concepto | sí |
| `categoriaSugerida` | string | ver §5 | sí |
| `ambitoSugerido` | string \| null | `"oficina"` \| `"campo"` \| `null` | sí |
| `creadoAt` | number | epoch ms | sí |
| `movimientoId` | string | push key del movimiento cruzado | sí |
| `fondo` | string | `"efectivo"` solo en fondo efectivo; ausente si no | no |

**Diferencias contra los otros items que publica esta app** (nómina, gasto
indirecto, carga social), que conviene tener presentes al consumir el buzón:

- `monto` aquí es un **number**, no el objeto `{subtotal, iva, importe}`. El
  desglose de IVA no se calcula ni se guarda: se manda el bruto y el flag
  `incluyeIva`, y el desglose queda del lado del contador.
- **No** lleva `creadoPor` (uid). La identidad del capturista está en
  `movimiento.autor`, no en el item.
- **No** lleva `clasificacion` ni `ambito` firmes, sino `categoriaSugerida` y
  `ambitoSugerido` — nombres deliberadamente "sugeridos" porque la palabra final
  es del contador.
- `creadoAt` se pone a mano en la vista. Esta ruta **no** pasa por
  `pushBuzonItem()`, que es quien normalmente lo añade solo.

---

## 4. Obra: id, nunca texto

La obra se representa **siempre por su id** (push key de Firebase), en dos
lugares: como **segmento de la ruta** del movimiento y como campo `obraId` del
item de buzón. El nombre de la obra **no se copia** a ningún lado.

**Catálogo de obras:** `/legacy/estimaciones/obras/{obraId}` — fuente única,
mantenida por app-estimaciones. Esta app solo lee (`listObrasLegacy()`).

```
/legacy/estimaciones/obras/{obraId}/meta = { nombre, contratoNo, cliente, ... }
```

Si no hay obras, la vista de caja chica no deja capturar nada.

**Mapeo a contabilidad:** `/shared/obraLinks/{obraId}` = `"proyectoId"` — un
**string plano**, no un objeto. Se resuelve con `getProyectoIdByObraId(obraId)`
al momento de reportar y el resultado se congela en `item.proyectoId`. Si la
obra no está vinculada, se escribe `null` y el contador tiene que vincularla
antes de aprobar.

**Catálogo de proyectos contables:** `/legacy/bitacora/sogrub_proyectos` (array;
campos `id`, `nombre`, `cliente`, `costo_directo_base`, `presupuesto_contrato`,
`estado`, `fecha_inicio`).

---

## 5. "Partida": no existe en este flujo

**No hay concepto de partida presupuestal en el gasto de caja chica.** No se
escribe ningún id de partida, concepto OPUS ni cuenta contable.

Lo más parecido es `categoriaSugerida`, y conviene ser exacto sobre lo que es:

- Es **texto libre**, no un id. Se guarda la etiqueta tal cual (`"Indirecto"`).
- Los cuatro valores posibles están **hardcodeados en el cliente**, en
  `js/views/cajachica.js:11`:

  ```js
  const CATEGORIAS = ['Indirecto', 'Material', 'Mano de Obra', 'Subcontratista'];
  ```

- **No vive en la base de datos.** Cambiar la lista requiere tocar código.
- Cuando vale `"Indirecto"`, la UI pide además `ambitoSugerido`
  (`"oficina"` | `"campo"`); para las otras tres categorías se escribe `null`.

**Ojo con la confusión fácil:** sí existe un catálogo de categorías en la BD, en
`/shared/indirectos/categorias_gasto/{id}` = `{ nombre, activa, orden, createdAt }`,
con ids slug (`oficina`, `gasolina`, `servicios`, `telefonia`, `viaticos`,
`mantenimiento`, `otros`). **Ese catálogo NO se usa en caja chica** — es
exclusivo de *Gastos indirectos* (`js/views/gastos.js`). Son dos taxonomías
distintas que no se cruzan.

También existe el catálogo OPUS de conceptos en `/shared/catalogos/{obraId}`
(solo lectura), pero **caja chica no lo toca**.

---

## 6. Método de pago: no aplica al gasto

**Un gasto de caja chica no tiene campo de método de pago**, por definición: se
pagó con el efectivo del fondo. No hay `metodoPago` ni equivalente.

Lo que sí existe, y solo en los **depósitos** (`tipo: "deposito"`), es
`metodoDeposito`: `"transferencia"` | `"efectivo"`.

Lo que se le parece en un gasto es `fondo`, que no dice *cómo* se pagó sino *de
qué bolsa salió*:

| `fondo` | Significado |
| --- | --- |
| ausente | Fondo transferencia — el saldo que se repone por transferencia bancaria |
| `"efectivo"` | Fondo de billete físico que el contador saca de la caja de SOGRUB |

Los dos fondos conviven por obra, con saldos separados, sobre la misma colección
de movimientos: se separan al leer, filtrando por `fondoDeMov(m)`.

---

## 7. Estado inicial y ciclo de vida

Un gasto recién reportado nace con **dos estados distintos**, uno en cada nodo:

| Nodo | Campo | Valor inicial |
| --- | --- | --- |
| Movimiento | `estado` | `"reportado"` |
| Item de buzón | `estado` | `"recibido"` |

Transiciones (las hace **el contador desde bitácora**, no esta app):

```
movimiento.estado:  reportado ──► aprobado
                              └─► rechazado
```

Efecto sobre el saldo del fondo (`calcSaldo`), que es lo que hace que el estado
importe:

| `estado` | Efecto |
| --- | --- |
| `"reportado"` | No toca el saldo. Suma a `reportadoPend` (visible como "Reportado pendiente") |
| `"aprobado"` | **Resta del saldo** y suma a `gastadoAprobado` |
| `"rechazado"` | No afecta nada |

Es decir: reportar un gasto **no baja el saldo**; el saldo baja cuando el
contador lo aprueba.

**Borrado:** app-indirectos solo puede borrar un movimiento propio
(`origen === "indirectos"`) que **no** esté `aprobado`. `borrarMovimientoCajaChica()`
borra el movimiento y su item de buzón en la misma operación atómica
(`{ [rutaMov]: null, [rutaItem]: null }`).

---

## 8. Foto del ticket: no está implementada

**No existe adjunto de imagen en el gasto de caja chica.** Ni en el movimiento
ni en el item de buzón hay campo de foto, URL de comprobante o referencia a un
archivo.

Estado real de la infraestructura:

- **Firebase Storage no se usa en toda la app.** `js/services/firebase.js` solo
  inicializa `app`, `auth` y `database`; el SDK de Storage ni se importa. El
  `storageBucket` que aparece en `js/config/firebase-config.js` es parte del
  objeto de configuración estándar del proyecto, pero está **inerte**.
- El único campo relacionado con el comprobante es **`factura`**: un **string**
  con el folio/serie escrito a mano. No es un archivo ni un enlace.
- El único mecanismo de adjuntos que existe en la app es para **documentos de
  empleados**, y es por **enlace a Google Drive**, no por subida: se guardan
  metadatos en `/shared/indirectos/empleados/{id}/documentos/{docId}` =
  `{ tipo, nombre, url, fecha, subidoPor }`. La subida real está sin conectar
  (`DRIVE_CONFIG.configurado === false` en `js/services/documentos.js`).

Si se quiere añadir la foto, el punto de integración natural sería el item de
buzón (es lo que ve el contador al aprobar), reutilizando el patrón de
`documentos.js`: guardar una URL, no el binario.

---

## 9. Ejemplo real anonimizado

Gasto de $2,320.00 con IVA incluido, pagado del fondo transferencia de la obra
`-Nx7kQpLm3aBcDeFgHi`, categoría Indirecto / ámbito campo.

**Movimiento** — `/shared/cajaChica/-Nx7kQpLm3aBcDeFgHi/movimientos/-OaBc1DeF2GhI3JkL4Mn`

```json
{
  "tipo": "gasto",
  "estado": "reportado",
  "monto": 2320,
  "fecha": 1785196800000,
  "comentario": "Gasolina camioneta supervision",
  "autor": {
    "uid": "aB3dEfGhIjKlMnOpQrStUvWxYz12",
    "email": "auxiliar@ejemplo.com",
    "displayName": "Auxiliar Administrativo"
  },
  "origen": "indirectos",
  "createdAt": 1785209446312,
  "buzonItemId": "-OaBc5PqR6StU7VwX8Yz"
}
```

**Item de buzón** — `/shared/buzon/-OaBc5PqR6StU7VwX8Yz`

```json
{
  "tipo": "gasto_caja_chica",
  "origenApp": "indirectos",
  "obraId": "-Nx7kQpLm3aBcDeFgHi",
  "proyectoId": "proy_014",
  "monto": 2320,
  "proveedor": "Gasolinera Ejemplo S.A. de C.V.",
  "factura": "A-10457",
  "comentario": "Gasolina camioneta supervision",
  "fecha": 1785196800000,
  "incluyeIva": true,
  "categoriaSugerida": "Indirecto",
  "ambitoSugerido": "campo",
  "estado": "recibido",
  "creadoAt": 1785209446312,
  "movimientoId": "-OaBc1DeF2GhI3JkL4Mn"
}
```

Variante del **fondo efectivo**: idéntica, más `"fondo": "efectivo"` en **ambos**
nodos.

Si la obra no estuviera vinculada a un proyecto contable, el único cambio sería
`"proyectoId": null`.

---

## 10. Resumen de invariantes

1. Un gasto = **dos nodos**, escritos atómicamente y cruzados por id
   (`buzonItemId` ↔ `movimientoId`).
2. La obra siempre es **id**, nunca nombre; el nombre se resuelve leyendo
   `/legacy/estimaciones/obras`.
3. `monto` es **bruto** y **number plano**; el IVA no se desglosa, solo se marca
   con `incluyeIva`.
4. Estados iniciales: movimiento `"reportado"`, buzón `"recibido"`.
5. El saldo **solo** se mueve con gastos `"aprobado"`.
6. No hay partida, no hay método de pago en el gasto, no hay foto.
7. Todo lo que esta app escribe lleva `origen: "indirectos"` (movimiento) y
   `origenApp: "indirectos"` (item de buzón).
