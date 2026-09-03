#!/usr/bin/env node
/**
 * Servidor MCP: registro de gastos de caja chica en la RTDB de sogrub-suite.
 *
 * Contrato de datos: docs/CONTRATO-GASTOS.md de app-indirectos.
 * Solo ALTA de gastos: no aprueba, no edita, no borra.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { iniciar } from './firebase.js';
import { CATEGORIAS } from './contrato.js';
import {
  listarObras,
  saldoFondo,
  buscarMovimientos,
  reservarMovimientoId,
  subirComprobante,
  registrarGasto,
} from './cajachica.js';

// stdout es el canal del protocolo: cualquier log va a stderr.
const log = (...args: unknown[]) => console.error('[sogrub-caja-chica]', ...args);

type Resultado = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const ok = (data: unknown): Resultado => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

const error = (e: unknown): Resultado => ({
  content: [{ type: 'text', text: `ERROR: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

const guard =
  <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
  async (...args: A): Promise<Resultado> => {
    try {
      return ok(await fn(...args));
    } catch (e) {
      log('fallo:', e);
      return error(e);
    }
  };

// ===== Esquemas compartidos =====

const obraId = z
  .string()
  .min(1)
  .describe('Id de la obra (push key de Firebase). Obtenlo con listar_obras.');

const movimientoId = z
  .string()
  .min(1)
  .describe('Id reservado con reservar_movimiento_id. Nombra el archivo en Storage.');

const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD')
  .describe('Fecha del gasto en formato YYYY-MM-DD (día en que se pagó).');

// ===== Servidor =====

const server = new McpServer({
  name: 'sogrub-caja-chica',
  version: '1.0.0',
});

server.registerTool(
  'listar_obras',
  {
    title: 'Listar obras',
    description:
      'Obras disponibles con su id, nombre, contrato, cliente y si están vinculadas a un proyecto contable. Úsala para resolver el id de la obra antes de cualquier otra herramienta.',
    inputSchema: {},
  },
  guard(async () => ({ obras: await listarObras() })),
);

server.registerTool(
  'saldo_fondo',
  {
    title: 'Saldo de la caja chica',
    description:
      'Saldo conciliado de la caja chica de una obra, por fondo (transferencia y efectivo), más lo depositado, lo gastado aprobado y lo reportado pendiente. Un gasto reportado no baja el saldo hasta que el contador lo aprueba.',
    inputSchema: { obraId },
  },
  guard(async ({ obraId }: { obraId: string }) => saldoFondo(obraId)),
);

server.registerTool(
  'buscar_movimientos',
  {
    title: 'Buscar movimientos',
    description:
      'Movimientos de la caja chica de una obra, opcionalmente filtrados por fecha y/o monto exacto. Úsala SIEMPRE antes de registrar un gasto, para descartar que ya esté capturado.',
    inputSchema: {
      obraId,
      fecha: fechaISO.optional().describe('Filtra por día (YYYY-MM-DD).'),
      monto: z.number().positive().optional().describe('Filtra por monto exacto (±0.01).'),
    },
  },
  guard(async ({ obraId, fecha, monto }: { obraId: string; fecha?: string; monto?: number }) =>
    buscarMovimientos(obraId, {
      ...(fecha !== undefined ? { fecha } : {}),
      ...(monto !== undefined ? { monto } : {}),
    }),
  ),
);

server.registerTool(
  'reservar_movimiento_id',
  {
    title: 'Reservar id de movimiento',
    description:
      'Reserva la push key del movimiento SIN escribir nada. Es el primer paso obligatorio: el id nombra el comprobante en Storage y luego se pasa a registrar_gasto, para que el gasto se publique en una sola escritura atómica ya con la URL.',
    inputSchema: { obraId },
  },
  guard(async ({ obraId }: { obraId: string }) => reservarMovimientoId(obraId)),
);

server.registerTool(
  'subir_comprobante',
  {
    title: 'Subir comprobante',
    description:
      'Sube la foto del ticket o el PDF de la factura a Storage en comprobantes/{obraId}/{movimientoId}.{ext} y devuelve la URL de descarga. Máximo 10 MB; solo image/* o application/pdf.',
    inputSchema: {
      obraId,
      movimientoId,
      base64: z
        .string()
        .min(1)
        .describe('Contenido del archivo en base64. Acepta también data URI.'),
      mimeType: z
        .string()
        .min(1)
        .describe('Tipo MIME real del archivo: image/jpeg, image/png, application/pdf…'),
    },
  },
  guard(
    async ({
      obraId,
      movimientoId,
      base64,
      mimeType,
    }: {
      obraId: string;
      movimientoId: string;
      base64: string;
      mimeType: string;
    }) => subirComprobante(obraId, movimientoId, base64, mimeType),
  ),
);

server.registerTool(
  'registrar_gasto',
  {
    title: 'Registrar gasto de caja chica',
    description:
      'Escribe el gasto: movimiento (estado "reportado") + item de buzón (estado "recibido") en una sola operación atómica. Requiere un movimientoId reservado y sin usar. No aprueba nada: el contador decide en bitácora.',
    inputSchema: {
      obraId,
      movimientoId,
      monto: z
        .number()
        .positive()
        .describe('Monto BRUTO tal como se pagó (con IVA incluido si lo trae).'),
      incluyeIva: z
        .boolean()
        .describe('true si el monto ya trae el IVA 16% incorporado; false si es subtotal.'),
      categoriaSugerida: z
        .enum(CATEGORIAS)
        .describe('Categoría contable sugerida. El contador tiene la última palabra.'),
      descripcion: z.string().min(1).describe('Concepto del gasto. Se guarda en ambos nodos.'),
      fecha: fechaISO,
      comprobanteUrl: z
        .string()
        .url()
        .optional()
        .describe('URL devuelta por subir_comprobante. Omitir solo si el gasto va sin ticket.'),
      factura: z.string().optional().describe('Folio o serie de la factura, si la hay.'),
    },
  },
  guard(
    async (args: {
      obraId: string;
      movimientoId: string;
      monto: number;
      incluyeIva: boolean;
      categoriaSugerida: (typeof CATEGORIAS)[number];
      descripcion: string;
      fecha: string;
      comprobanteUrl?: string;
      factura?: string;
    }) =>
      registrarGasto({
        obraId: args.obraId,
        movimientoId: args.movimientoId,
        monto: args.monto,
        incluyeIva: args.incluyeIva,
        categoriaSugerida: args.categoriaSugerida,
        descripcion: args.descripcion,
        fecha: args.fecha,
        ...(args.comprobanteUrl !== undefined ? { comprobanteUrl: args.comprobanteUrl } : {}),
        ...(args.factura !== undefined ? { factura: args.factura } : {}),
      }),
  ),
);

async function main() {
  // Falla temprano y con mensaje claro si falta configuración.
  const cfg = iniciar();
  log(`RTDB ${cfg.databaseURL} · bucket ${cfg.storageBucket} · autor ${cfg.autor.uid}`);
  await server.connect(new StdioServerTransport());
  log('listo (stdio)');
}

main().catch((e) => {
  log('no se pudo iniciar:', e instanceof Error ? e.message : e);
  process.exit(1);
});
