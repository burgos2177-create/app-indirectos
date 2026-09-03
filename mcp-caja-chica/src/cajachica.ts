/**
 * Operaciones sobre la caja chica. Réplica exacta de lo que hace
 * app-indirectos (`reportarGastoCajaChica` + `calcSaldo`), según
 * docs/CONTRATO-GASTOS.md.
 *
 * Este servidor SOLO crea gastos. No aprueba, no edita y no borra: esos
 * estados los mueve el contador desde bitácora.
 */

import { randomUUID } from 'node:crypto';
import { db, bucket, autor } from './firebase.js';
import {
  RUTA_OBRAS,
  RUTA_OBRA_LINKS,
  RUTA_BUZON,
  rutaMovimientos,
  rutaMovimiento,
  rutaBuzonItem,
  BUZON_TIPO_GASTO,
  ORIGEN_APP_BUZON,
  ORIGEN_MOVIMIENTO,
  ESTADO_MOVIMIENTO_INICIAL,
  ESTADO_BUZON_INICIAL,
  MAX_BYTES_COMPROBANTE,
  esMimePermitido,
  rutaComprobante,
  fechaISOaEpochLocal,
  rangoDelDia,
  epochAISOLocal,
  fondoDeMov,
  type Categoria,
  type Fondo,
  type MovimientoGasto,
  type ItemBuzonGasto,
  type MovimientoLeido,
} from './contrato.js';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

async function leer<T>(ruta: string): Promise<T | null> {
  const snap = await db().ref(ruta).get();
  return snap.exists() ? (snap.val() as T) : null;
}

// ===================== listar_obras =====================

export interface ObraResumen {
  obraId: string;
  nombre: string;
  contratoNo: string | null;
  cliente: string | null;
  proyectoId: string | null;
}

export async function listarObras(): Promise<ObraResumen[]> {
  const [obras, links] = await Promise.all([
    leer<Record<string, { meta?: Record<string, unknown> }>>(RUTA_OBRAS),
    leer<Record<string, string>>(RUTA_OBRA_LINKS),
  ]);
  return Object.entries(obras || {})
    .map(([obraId, obra]) => {
      const meta = obra?.meta || {};
      return {
        obraId,
        nombre: String(meta.nombre ?? obraId),
        contratoNo: meta.contratoNo != null ? String(meta.contratoNo) : null,
        cliente: meta.cliente != null ? String(meta.cliente) : null,
        proyectoId: (links || {})[obraId] ?? null,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

async function obraExiste(obraId: string): Promise<boolean> {
  return (await leer(`${RUTA_OBRAS}/${obraId}`)) !== null;
}

async function exigirObra(obraId: string): Promise<void> {
  if (!(await obraExiste(obraId))) {
    throw new Error(
      `La obra "${obraId}" no existe en ${RUTA_OBRAS}. Usa listar_obras para ver los ids válidos.`,
    );
  }
}

// ===================== saldo_fondo =====================

export interface SaldoFondo {
  fondo: Fondo;
  saldo: number;
  depositado: number;
  gastadoAprobado: number;
  reportadoPend: number;
  depositoPend: number;
}

/**
 * Fórmula EXACTA de app-indirectos (`calcSaldo`). No cambiar sin cambiarla
 * también en materiales y bitácora.
 */
function calcSaldo(movs: Record<string, MovimientoLeido>, fondo: Fondo): SaldoFondo {
  let saldo = 0;
  let depositado = 0;
  let gastadoAprobado = 0;
  let reportadoPend = 0;
  let depositoPend = 0;

  for (const m of Object.values(movs || {})) {
    if (fondoDeMov(m) !== fondo) continue;
    const monto = Number(m.monto) || 0;

    if (m.tipo === 'deposito') {
      const metodo = m.metodoDeposito || 'transferencia';
      if (fondo === 'transferencia' && metodo === 'efectivo') continue; // informativo legacy
      const estado = m.estado || 'aprobado'; // legacy default
      if (estado === 'aprobado') {
        saldo += monto;
        depositado += monto;
      } else if (estado === 'solicitado') {
        depositoPend += monto;
      }
      // rechazado: no afecta
    } else if (m.tipo === 'gasto') {
      if (m.estado === 'aprobado') {
        saldo -= monto;
        gastadoAprobado += monto;
      } else if (m.estado === 'reportado') {
        reportadoPend += monto;
      }
      // rechazado: no afecta
    }
  }

  return {
    fondo,
    saldo: round2(saldo),
    depositado: round2(depositado),
    gastadoAprobado: round2(gastadoAprobado),
    reportadoPend: round2(reportadoPend),
    depositoPend: round2(depositoPend),
  };
}

export async function saldoFondo(obraId: string) {
  await exigirObra(obraId);
  const movs = (await leer<Record<string, MovimientoLeido>>(rutaMovimientos(obraId))) || {};
  return {
    obraId,
    // Este servidor escribe siempre al fondo transferencia (no manda `fondo`).
    fondoDeEsteServidor: 'transferencia' as Fondo,
    transferencia: calcSaldo(movs, 'transferencia'),
    efectivo: calcSaldo(movs, 'efectivo'),
    nota:
      'Un gasto reportado NO baja el saldo; baja cuando el contador lo aprueba en bitácora.',
  };
}

// ===================== buscar_movimientos =====================

export interface MovimientoResumen {
  movimientoId: string;
  tipo: string;
  estado: string;
  monto: number;
  fecha: string | null;
  fechaMs: number | null;
  comentario: string | null;
  proveedor: string | null;
  origen: string | null;
  fondo: Fondo;
  tieneComprobante: boolean;
  comprobanteUrl: string | null;
  buzonItemId: string | null;
}

export async function buscarMovimientos(
  obraId: string,
  filtros: { fecha?: string; monto?: number } = {},
): Promise<{ obraId: string; total: number; filtros: typeof filtros; movimientos: MovimientoResumen[] }> {
  await exigirObra(obraId);
  const movs = (await leer<Record<string, MovimientoLeido>>(rutaMovimientos(obraId))) || {};

  let rango: { inicio: number; fin: number } | null = null;
  if (filtros.fecha) rango = rangoDelDia(fechaISOaEpochLocal(filtros.fecha));

  const filas: MovimientoResumen[] = [];
  for (const [movimientoId, m] of Object.entries(movs)) {
    const fechaMs = Number(m.fecha) || Number(m.createdAt) || null;
    if (rango) {
      if (fechaMs == null || fechaMs < rango.inicio || fechaMs >= rango.fin) continue;
    }
    if (filtros.monto != null) {
      if (Math.abs((Number(m.monto) || 0) - filtros.monto) > 0.01) continue;
    }
    filas.push({
      movimientoId,
      tipo: m.tipo ?? '—',
      estado: m.estado ?? (m.tipo === 'deposito' ? 'aprobado' : '—'),
      monto: Number(m.monto) || 0,
      fecha: epochAISOLocal(fechaMs),
      fechaMs,
      comentario: m.comentario ?? null,
      proveedor: m.proveedor ?? null,
      origen: m.origen ?? null,
      fondo: fondoDeMov(m),
      tieneComprobante: Boolean(m.comprobanteUrl),
      comprobanteUrl: m.comprobanteUrl ?? null,
      buzonItemId: m.buzonItemId ?? null,
    });
  }

  filas.sort((a, b) => (b.fechaMs ?? 0) - (a.fechaMs ?? 0));
  return { obraId, total: filas.length, filtros, movimientos: filas };
}

// ===================== reservar_movimiento_id =====================

/**
 * Push key reservada por adelantado (§8). Sirve para nombrar el comprobante en
 * Storage ANTES de escribir en la BD, y así publicar movimiento + item de buzón
 * en una sola escritura atómica ya con la URL dentro.
 *
 * Reservar no escribe nada: si no se usa, no queda basura.
 */
export async function reservarMovimientoId(obraId: string) {
  await exigirObra(obraId);
  const movimientoId = db().ref(rutaMovimientos(obraId)).push().key;
  if (!movimientoId) throw new Error('Firebase no devolvió una push key.');
  return {
    obraId,
    movimientoId,
    rutaMovimiento: rutaMovimiento(obraId, movimientoId),
    nota: 'Aún no se escribió nada. Úsalo en subir_comprobante y luego en registrar_gasto.',
  };
}

// ===================== subir_comprobante =====================

export async function subirComprobante(
  obraId: string,
  movimientoId: string,
  base64: string,
  mimeType: string,
) {
  await exigirObra(obraId);

  if (!esMimePermitido(mimeType)) {
    throw new Error(
      `Tipo "${mimeType}" no permitido. Solo se aceptan image/* y application/pdf.`,
    );
  }

  // Acepta tanto base64 puro como data URI ("data:image/jpeg;base64,...").
  const limpio = base64.includes(',') && base64.trimStart().startsWith('data:')
    ? base64.slice(base64.indexOf(',') + 1)
    : base64;
  const buf = Buffer.from(limpio.replace(/\s/g, ''), 'base64');
  if (buf.length === 0) throw new Error('El base64 está vacío o es inválido.');
  if (buf.length > MAX_BYTES_COMPROBANTE) {
    throw new Error(
      `El archivo pesa ${(buf.length / 1024 / 1024).toFixed(1)} MB; el máximo es 10 MB.`,
    );
  }

  const ruta = rutaComprobante(obraId, movimientoId, mimeType);
  const b = bucket();
  const file = b.file(ruta);

  // Token de descarga: reproduce el mismo formato de URL que genera
  // getDownloadURL() en el cliente web, para que el comprobante se vea igual
  // venga de la app o de aquí.
  const token = randomUUID();
  await file.save(buf, {
    resumable: false,
    metadata: {
      contentType: mimeType,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  const url =
    `https://firebasestorage.googleapis.com/v0/b/${b.name}/o/` +
    `${encodeURIComponent(ruta)}?alt=media&token=${token}`;

  return { obraId, movimientoId, rutaStorage: ruta, bytes: buf.length, mimeType, comprobanteUrl: url };
}

// ===================== registrar_gasto =====================

export interface RegistrarGastoParams {
  obraId: string;
  movimientoId: string;
  monto: number;
  incluyeIva: boolean;
  categoriaSugerida: Categoria;
  descripcion: string;
  fecha: string;
  comprobanteUrl?: string;
  factura?: string;
}

export async function registrarGasto(p: RegistrarGastoParams) {
  await exigirObra(p.obraId);

  const monto = round2(p.monto);
  if (!(monto > 0)) throw new Error('El monto debe ser mayor a 0.');

  const comentario = (p.descripcion || '').trim();
  if (!comentario) throw new Error('La descripción del gasto no puede ir vacía.');

  const movimientoId = (p.movimientoId || '').trim();
  if (!movimientoId || movimientoId.includes('/')) {
    throw new Error('movimientoId inválido. Obtén uno con reservar_movimiento_id.');
  }

  // Guardia de idempotencia: registrar dos veces con el mismo id sobrescribiría
  // el movimiento anterior en silencio.
  const yaExiste = await leer(rutaMovimiento(p.obraId, movimientoId));
  if (yaExiste) {
    throw new Error(
      `El movimiento ${movimientoId} ya existe en esta obra. Reserva un id nuevo si es otro gasto.`,
    );
  }

  const fecha = fechaISOaEpochLocal(p.fecha);
  const proyectoId = await leer<string>(`${RUTA_OBRA_LINKS}/${p.obraId}`);
  const ahora = Date.now();

  const itemId = db().ref(RUTA_BUZON).push().key;
  if (!itemId) throw new Error('Firebase no devolvió una push key para el buzón.');

  const movimiento: MovimientoGasto = {
    tipo: 'gasto',
    estado: ESTADO_MOVIMIENTO_INICIAL,
    monto,
    fecha,
    comentario,
    autor: autor(),
    origen: ORIGEN_MOVIMIENTO,
    createdAt: ahora,
    buzonItemId: itemId,
    // `fondo` se omite a propósito: ausente = fondo transferencia (§2).
    ...(p.comprobanteUrl ? { comprobanteUrl: p.comprobanteUrl } : {}),
  };

  const item: ItemBuzonGasto = {
    tipo: BUZON_TIPO_GASTO,
    origenApp: ORIGEN_APP_BUZON,
    estado: ESTADO_BUZON_INICIAL,
    obraId: p.obraId,
    proyectoId: proyectoId ?? null,
    monto,
    // Este servidor no captura proveedor ni ámbito; el contador los completa.
    proveedor: null,
    factura: (p.factura || '').trim() || null,
    comentario,
    fecha,
    incluyeIva: Boolean(p.incluyeIva),
    categoriaSugerida: p.categoriaSugerida,
    ambitoSugerido: null,
    creadoAt: ahora,
    movimientoId,
  };

  // §1: UNA sola escritura atómica multi-path en la raíz. O se escriben los dos
  // nodos, o ninguno.
  await db()
    .ref()
    .update({
      [rutaMovimiento(p.obraId, movimientoId)]: movimiento,
      [rutaBuzonItem(itemId)]: item,
    });

  return {
    ok: true,
    obraId: p.obraId,
    movimientoId,
    buzonItemId: itemId,
    proyectoId: proyectoId ?? null,
    monto,
    fecha: p.fecha,
    categoriaSugerida: p.categoriaSugerida,
    comprobante: p.comprobanteUrl ? 'adjunto' : 'sin comprobante',
    rutas: {
      movimiento: rutaMovimiento(p.obraId, movimientoId),
      buzon: rutaBuzonItem(itemId),
    },
    nota:
      proyectoId == null
        ? 'La obra NO está vinculada a un proyecto contable (proyectoId: null); el contador tendrá que vincularla antes de aprobar.'
        : 'Queda en estado reportado/recibido. El saldo baja cuando el contador lo apruebe.',
  };
}
