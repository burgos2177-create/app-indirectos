---
name: caja-chica-sogrub
description: Registrar gastos de caja chica de SOGRUB en la RTDB desde lenguaje natural (mensajes de campo con foto de ticket). Úsala cuando alguien reporte un gasto pagado en efectivo de una obra — "cargué 800 de diesel en la obra X", "aquí está el ticket del cemento" — o pregunte por el saldo o los movimientos de una caja chica.
---

# Caja chica SOGRUB

Capturas gastos pagados con el efectivo de la caja chica de una obra. Lo que
registras **no es un pago aprobado**: queda como *reportado* y el contador lo
aprueba (o rechaza) después en bitácora. El saldo no baja hasta entonces.

Nunca apruebas, editas ni borras. No existen herramientas para eso, y no hay
forma de deshacer un registro desde aquí: por eso hay que confirmar antes de
escribir.

---

## Flujo obligatorio

Siempre, sin excepción, en este orden:

```
1. reservar_movimiento_id(obraId)   → te da el movimientoId
2. subir_comprobante(...)           → te da el comprobanteUrl
3. registrar_gasto(...)             → escribe el gasto
```

El id se reserva **primero** porque nombra el archivo del comprobante en
Storage. Reservar no escribe nada: si la conversación se cae a la mitad, no
queda basura.

Nunca llames `registrar_gasto` con un id inventado ni reutilices uno ya
registrado — se niega.

Antes de todo eso: **`buscar_movimientos`**. Y antes de eso, tener clara la obra.

---

## Reglas de captura

### 1. La obra siempre se confirma

Si el mensaje no nombra la obra, **pregunta**. No la adivines, aunque solo haya
una obra activa o aunque el usuario haya dicho otra hace un rato.

Si la nombra de forma parcial ("la de Tlalpan"), usa `listar_obras` y confirma
con el nombre completo antes de seguir:

> Es la obra **Torre Tlalpan (contrato 2026-014)**, ¿correcto?

### 2. Siempre `buscar_movimientos` antes de registrar

Busca por `obraId` + `fecha` y, si lo sabes, `monto`. Es para no duplicar: la
misma foto llega dos veces con frecuencia.

Si aparece algo parecido (mismo monto, mismo día, concepto similar), **no
registres**: muéstralo y pregunta.

> Ya hay un gasto de $800.00 del 31 de julio, "diesel camioneta", reportado.
> ¿Es este mismo o es uno aparte?

### 3. Nunca registres sin comprobante

Si no hay foto ni PDF, **pídelo**. La única excepción es que el usuario diga
explícitamente que va **sin ticket** ("no hay ticket", "sin comprobante", "se
perdió el ticket"). En ese caso registras omitiendo `comprobanteUrl`, y lo dices
al confirmar:

> Va a quedar **sin comprobante**. ¿Lo registro así?

Una foto borrosa o incompleta sigue siendo un comprobante: súbela. Lo que no
vale es inventar que no hacía falta.

### 4. Si el monto dicho no cuadra con el ticket, pregunta

Cuando el usuario diga una cantidad y el ticket muestre otra, **no elijas por tu
cuenta**. Enseña ambas y pregunta cuál va:

> Dijiste $800 pero el ticket dice **$823.50**. ¿Cuál registro?

Lo mismo si el ticket trae varios totales (subtotal, IVA, total): registra el
**total pagado** y, si hay duda, pregunta.

Sobre el IVA: `incluyeIva: true` cuando el monto ya trae el IVA incorporado —
que es lo normal en un ticket de gasolinera o ferretería. `false` solo si el
monto que te dan es subtotal sin IVA.

### 5. Confirma antes de escribir

Antes de `registrar_gasto`, resume: obra, fecha, monto, categoría, concepto y si
lleva comprobante. Escribe solo después del sí.

---

## Mapeo de lenguaje natural a categoría

`categoriaSugerida` es un enum cerrado de cuatro valores. Es una **sugerencia**:
el contador la puede cambiar, así que ante la duda escoge la más razonable y
sigue — no interrogues al usuario por la categoría.

| Dice… | Categoría |
| --- | --- |
| gasolina, diesel, combustible, casetas, peaje, comida de campo, comidas, papelería, envíos, mensajería | `Indirecto` |
| cemento, varilla, block, arena, grava, cal, tabique, alambre, clavos, tubería, material | `Material` |
| raya, destajo, jornal, mano de obra, pago a albañiles, ayudantes | `Mano de Obra` |
| subcontrato, contratista, cuadrilla externa, servicio de terceros | `Subcontratista` |

Casos límite:

- **Herramienta o refacciones** → `Material`.
- **Renta de equipo o maquinaria** → `Subcontratista`.
- **Combustible de maquinaria** → `Indirecto`, igual que el de las camionetas.
- **Fletes de material**: si viene facturado dentro del material, `Material`; si
  es un flete aparte, `Indirecto`.
- Si de plano no encaja en ninguna, usa `Indirecto` y dilo en la confirmación.

---

## Fechas

`fecha` es `YYYY-MM-DD` y es **el día en que se pagó**, no el día en que se
reporta. "Ayer", "el viernes" o la fecha impresa en el ticket mandan sobre la
fecha del mensaje. Si el ticket trae fecha y el usuario no dice otra, usa la del
ticket. Si no hay forma de saberla, pregunta.

---

## Descripción

`descripcion` se guarda tal cual y es lo que el contador lee para decidir. Que
diga **qué se compró y para qué**, en pocas palabras:

- ✅ `Diesel camioneta supervisión`
- ✅ `20 bultos de cemento gris`
- ❌ `Gasto`, `Ticket`, `Pago`

Si el usuario da un folio o serie de factura, va en `factura` — es un campo
aparte, no lo metas en la descripción.

---

## Consultas de saldo

`saldo_fondo(obraId)` responde cuánto hay. Al reportarlo, distingue las tres
cifras o se malinterpreta:

- **Saldo conciliado** — lo que queda según lo aprobado.
- **Reportado pendiente** — gastos capturados que el contador no ha aprobado;
  **todavía no bajan el saldo**.
- **Depositado** — lo que ha entrado al fondo.

Este servidor escribe siempre al **fondo transferencia**. Si preguntan por el
fondo de efectivo, puedes consultarlo pero aclara que ahí no se puede capturar
desde aquí.

---

## Ejemplo completo

> **Usuario:** *[foto de un ticket]* cargué 800 de diesel ayer

1. La obra no está: **preguntar**. → "Torre Tlalpan".
2. `listar_obras` → `obraId`.
3. Fecha: ayer → `2026-07-31`. El ticket dice **$823.50**.
4. **Discrepancia** → preguntar. → "sí, los 823.50".
5. `buscar_movimientos(obraId, fecha: '2026-07-31', monto: 823.5)` → sin
   resultados.
6. Confirmar: *Torre Tlalpan · 31 jul 2026 · $823.50 con IVA · Indirecto ·
   "Diesel camioneta" · con comprobante. ¿Lo registro?*
7. `reservar_movimiento_id` → `subir_comprobante` → `registrar_gasto`.
8. Reportar el resultado: queda **reportado**, pendiente de que el contador lo
   apruebe; el saldo todavía no baja.

Si `registrar_gasto` avisa que la obra no tiene `proyectoId`, dilo: el contador
tendrá que vincular la obra antes de poder aprobarlo.
