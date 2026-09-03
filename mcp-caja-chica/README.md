# sogrub-caja-chica — servidor MCP

Registra **gastos de caja chica** en la Realtime Database de `sogrub-suite`,
siguiendo al pie de la letra el contrato de escritura de app-indirectos:
[`docs/CONTRATO-GASTOS.md`](../docs/CONTRATO-GASTOS.md).

Pensado para capturar desde lenguaje natural (p. ej. un mensaje de Telegram con
la foto del ticket) sin abrir la app.

**Solo da de alta gastos.** No aprueba, no edita y no borra: esos estados los
mueve el contador desde bitácora. No hay herramienta que pueda hacerlo.

---

## Qué escribe

Un gasto son **dos nodos** publicados en **una sola escritura atómica**
(multi-path `update()` en la raíz), cruzados por id:

```
/shared/cajaChica/{obraId}/movimientos/{movId}   estado: "reportado"   origen: "telegram"
/shared/buzon/{itemId}                           estado: "recibido"    tipo: "gasto_caja_chica"
```

El comprobante va a Firebase Storage en
`comprobantes/{obraId}/{movimientoId}.{ext}` y su URL se guarda en
`comprobanteUrl`, **solo en el movimiento**.

### Decisiones que conviene conocer

| Punto | Qué hace y por qué |
| --- | --- |
| `origen: "telegram"` | En el **movimiento**, para distinguir la procedencia de la captura. |
| `origenApp: "indirectos"` | En el **item de buzón** se conserva el literal del contrato: es el valor que bitácora reconoce para consumir este tipo de item. La procedencia real se lee en `movimiento.origen`. |
| Efecto colateral | app-indirectos solo permite borrar movimientos con `origen === "indirectos"`. Con `"telegram"`, lo capturado aquí **no se puede borrar desde la app** — es intencional, dado que este servidor tampoco borra. |
| Fondo | Siempre el **fondo transferencia**: el campo `fondo` se omite, que es lo que el contrato define como ausente-por-defecto. No hay forma de capturar al fondo efectivo. |
| `proveedor` y `ambitoSugerido` | Siempre `null`. El servidor no los pregunta; el contador los completa al aprobar (por eso el campo se llama *sugerido*). |
| Saldo | Un gasto reportado **no baja el saldo**. Baja cuando el contador lo aprueba. |

---

## Requisitos

- Node.js ≥ 20
- Una cuenta de servicio del proyecto Firebase `sogrub-suite` con permiso de
  escritura en Realtime Database y Storage.

## Instalación

```bash
cd mcp-caja-chica
npm install
npm run build
```

## Configuración

Todo por variables de entorno.

| Variable | Obligatoria | Default | Para qué |
| --- | --- | --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | **sí** | — | Ruta **absoluta** al JSON de la cuenta de servicio. |
| `SOGRUB_AUTOR_UID` | **sí** | — | Va a `movimiento.autor.uid`: a quién se le atribuye la captura. |
| `SOGRUB_AUTOR_EMAIL` | no | `null` | `movimiento.autor.email`. |
| `SOGRUB_AUTOR_NOMBRE` | no | `null` | `movimiento.autor.displayName`. |
| `FIREBASE_DATABASE_URL` | no | `https://sogrub-suite-default-rtdb.firebaseio.com` | RTDB destino. |
| `FIREBASE_STORAGE_BUCKET` | no | `sogrub-suite.firebasestorage.app` | Bucket de comprobantes. |
| `TZ` | recomendada | la del sistema | **Ponla en `America/Mexico_City`.** El contrato define `fecha` como epoch ms a *medianoche local*; si el proceso corre en UTC, los gastos caen un día antes. |

El servidor **falla al arrancar** con un mensaje claro si falta alguna de las
obligatorias. Nunca se pasan credenciales como argumento de herramienta.

> El JSON de la cuenta de servicio no debe subirse al repositorio.
> `.gitignore` ya excluye `serviceAccount*.json` y `.env`.

## Registrarlo en Claude Code

Con el CLI (recomendado):

```bash
claude mcp add sogrub-caja-chica \
  --env GOOGLE_APPLICATION_CREDENTIALS=/ruta/absoluta/serviceAccount.json \
  --env SOGRUB_AUTOR_UID=EL_UID_DEL_CAPTURISTA \
  --env SOGRUB_AUTOR_NOMBRE="Auxiliar Administrativo" \
  --env TZ=America/Mexico_City \
  -- node /ruta/absoluta/mcp-caja-chica/dist/index.js
```

O a mano, en `.mcp.json` del proyecto (o `~/.claude.json` para dejarlo global):

```json
{
  "mcpServers": {
    "sogrub-caja-chica": {
      "command": "node",
      "args": ["/ruta/absoluta/mcp-caja-chica/dist/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/ruta/absoluta/serviceAccount.json",
        "SOGRUB_AUTOR_UID": "EL_UID_DEL_CAPTURISTA",
        "SOGRUB_AUTOR_NOMBRE": "Auxiliar Administrativo",
        "TZ": "America/Mexico_City"
      }
    }
  }
}
```

Verifica con `/mcp` dentro de Claude Code: debe aparecer `sogrub-caja-chica`
conectado con 6 herramientas.

Junto a este README está **[`SKILL.md`](./SKILL.md)**, con el flujo obligatorio y
las reglas de captura. Cárgalo como skill (o pégalo en el system prompt del bot)
para que el modelo use las herramientas en el orden correcto.

---

## Herramientas

| Herramienta | Para qué |
| --- | --- |
| `listar_obras()` | Obras con id, nombre, contrato, cliente y `proyectoId`. |
| `saldo_fondo(obraId)` | Saldo conciliado por fondo + depositado, gastado aprobado y reportado pendiente. |
| `buscar_movimientos(obraId, fecha?, monto?)` | Movimientos filtrados. **Anti-duplicados.** |
| `reservar_movimiento_id(obraId)` | Push key sin escribir nada. |
| `subir_comprobante(obraId, movimientoId, base64, mimeType)` | Sube a Storage y devuelve la URL. |
| `registrar_gasto(obraId, movimientoId, monto, incluyeIva, categoriaSugerida, descripcion, fecha, comprobanteUrl?, factura?)` | Escritura atómica de los dos nodos. |

### Orden obligatorio

```
reservar_movimiento_id  →  subir_comprobante  →  registrar_gasto
```

El id se reserva primero porque **nombra el archivo en Storage**. Así el
movimiento nace ya con su `comprobanteUrl` en la misma escritura atómica, sin
un estado intermedio donde el contador vería el gasto sin comprobante.

### Validaciones

- `categoriaSugerida`: enum cerrado — `Indirecto`, `Material`, `Mano de Obra`,
  `Subcontratista`.
- `fecha`: `YYYY-MM-DD`; rechaza formatos raros y días inexistentes (`2026-02-31`).
- `monto` > 0.
- Comprobante: ≤ 10 MB, solo `image/*` o `application/pdf` (espejo de
  `storage.rules`).
- La obra debe existir en `/legacy/estimaciones/obras`.
- **Idempotencia:** si el `movimientoId` ya existe en esa obra, `registrar_gasto`
  se niega en vez de sobrescribir. Reserva un id nuevo para cada gasto.

---

## Desarrollo

```bash
npm run typecheck   # tsc --noEmit
npm run build       # compila a dist/
npm run watch       # compila en caliente
```

Prueba del handshake sin tocar Firebase (la conexión a la BD es perezosa: se
abre en la primera llamada a una herramienta):

```bash
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node dist/index.js
```

Los logs van a **stderr**; `stdout` es exclusivo del protocolo.

## Estructura

```
src/
  index.ts       registro de las 6 herramientas (MCP SDK + zod)
  contrato.ts    traducción de docs/CONTRATO-GASTOS.md: rutas, literales, tipos
  cajachica.ts   operaciones (réplica de reportarGastoCajaChica y calcSaldo)
  firebase.ts    init de firebase-admin (Database + Storage)
```

Si el contrato cambia, se cambia `contrato.ts`.
