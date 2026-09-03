/**
 * Constantes y helpers que traducen docs/CONTRATO-GASTOS.md de app-indirectos.
 *
 * Este archivo es la única fuente de verdad sobre el contrato dentro del
 * servidor: si el contrato cambia, se cambia aquí.
 */

// === Rutas en RTDB (§1 del contrato) ===

export const RUTA_OBRAS = '/legacy/estimaciones/obras';
export const RUTA_OBRA_LINKS = '/shared/obraLinks';
export const RUTA_BUZON = '/shared/buzon';
export const rutaCajaChica = (obraId: string) => `/shared/cajaChica/${obraId}`;
export const rutaMovimientos = (obraId: string) => `${rutaCajaChica(obraId)}/movimientos`;
export const rutaMovimiento = (obraId: string, movId: string) =>
  `${rutaMovimientos(obraId)}/${movId}`;
export const rutaBuzonItem = (itemId: string) => `${RUTA_BUZON}/${itemId}`;

// === Literales del contrato ===

/** Tipo de item que bitácora consume del buzón (§3). */
export const BUZON_TIPO_GASTO = 'gasto_caja_chica';

/**
 * §3: `origenApp` del item de buzón. Se mantiene "indirectos" a propósito —
 * es el literal que bitácora reconoce para consumir este tipo de item. La
 * procedencia real de esta captura se distingue por `origen` en el movimiento.
 */
export const ORIGEN_APP_BUZON = 'indirectos';

/** §2: `origen` del movimiento — de dónde vino la captura. */
export const ORIGEN_MOVIMIENTO = 'telegram';

/** §7: estados iniciales. */
export const ESTADO_MOVIMIENTO_INICIAL = 'reportado';
export const ESTADO_BUZON_INICIAL = 'recibido';

/**
 * §5: enum CERRADO. Es texto libre en la BD, pero solo estos cuatro valores
 * son válidos; están hardcodeados igual que en la app.
 */
export const CATEGORIAS = ['Indirecto', 'Material', 'Mano de Obra', 'Subcontratista'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

// === Comprobante (§8) ===

export const MAX_BYTES_COMPROBANTE = 10 * 1024 * 1024; // 10 MB

const EXT_POR_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export function esMimePermitido(mime: string): boolean {
  const m = (mime || '').toLowerCase().trim();
  return m === 'application/pdf' || m.startsWith('image/');
}

/** Extensión con la que se nombra el archivo en Storage. */
export function extensionDeMime(mime: string): string {
  const m = (mime || '').toLowerCase().trim();
  const conocida = EXT_POR_MIME[m];
  if (conocida) return conocida;
  // image/svg+xml → svg, image/tiff → tiff…
  if (m.startsWith('image/')) {
    const sub = m.slice('image/'.length).split('+')[0]?.replace(/[^a-z0-9]/g, '') || '';
    if (sub) return sub;
  }
  return 'bin';
}

/** §8: comprobantes/{obraId}/{movimientoId}.{ext} */
export function rutaComprobante(obraId: string, movimientoId: string, mime: string): string {
  return `comprobantes/${obraId}/${movimientoId}.${extensionDeMime(mime)}`;
}

// === Fechas ===

/**
 * §2: `fecha` es epoch ms a MEDIANOCHE LOCAL del día capturado. Se calcula con
 * la zona horaria del proceso, así que el servidor debe correr con
 * TZ=America/Mexico_City (ver README).
 */
export function fechaISOaEpochLocal(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  if (!m) throw new Error(`Fecha inválida "${iso}": se espera formato YYYY-MM-DD.`);
  const [y, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const fecha = new Date(y, mes - 1, d, 0, 0, 0, 0);
  // Rechaza fechas imposibles que Date normalizaría en silencio (2026-02-31).
  if (fecha.getFullYear() !== y || fecha.getMonth() !== mes - 1 || fecha.getDate() !== d) {
    throw new Error(`Fecha inexistente: ${iso}.`);
  }
  return fecha.getTime();
}

/** Rango [inicio, fin) del día local que contiene ese epoch. */
export function rangoDelDia(epochMs: number): { inicio: number; fin: number } {
  const d = new Date(epochMs);
  const inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
  const fin = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
  return { inicio, fin };
}

export function epochAISOLocal(epochMs: number | null | undefined): string | null {
  if (!epochMs) return null;
  const d = new Date(epochMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// === Tipos de los nodos que se escriben ===

export interface Autor {
  uid: string | null;
  email: string | null;
  displayName: string | null;
}

/** Nodo /shared/cajaChica/{obraId}/movimientos/{movId} — §2 */
export interface MovimientoGasto {
  tipo: 'gasto';
  estado: typeof ESTADO_MOVIMIENTO_INICIAL;
  monto: number;
  fecha: number;
  comentario: string;
  autor: Autor;
  origen: string;
  createdAt: number;
  buzonItemId: string;
  /** Opcional, ausente-por-defecto (§8). */
  comprobanteUrl?: string;
}

/** Nodo /shared/buzon/{itemId} — §3 */
export interface ItemBuzonGasto {
  tipo: typeof BUZON_TIPO_GASTO;
  origenApp: string;
  estado: typeof ESTADO_BUZON_INICIAL;
  obraId: string;
  proyectoId: string | null;
  monto: number;
  proveedor: string | null;
  factura: string | null;
  comentario: string | null;
  fecha: number;
  incluyeIva: boolean;
  categoriaSugerida: Categoria;
  ambitoSugerido: 'oficina' | 'campo' | null;
  creadoAt: number;
  movimientoId: string;
}

/** Movimiento tal como se lee de la BD (puede venir de otras apps). */
export interface MovimientoLeido {
  tipo?: string;
  estado?: string;
  monto?: number;
  fecha?: number;
  createdAt?: number;
  comentario?: string | null;
  origen?: string;
  fondo?: string;
  metodoDeposito?: string;
  comprobanteUrl?: string;
  buzonItemId?: string;
  proveedor?: string | null;
  autor?: Partial<Autor>;
}

/** §2: `fondo` es ausente-por-defecto. */
export type Fondo = 'transferencia' | 'efectivo';
export const fondoDeMov = (m: MovimientoLeido | null | undefined): Fondo =>
  m?.fondo === 'efectivo' ? 'efectivo' : 'transferencia';
