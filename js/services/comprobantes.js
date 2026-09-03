// Comprobantes de gasto de caja chica (foto del ticket o PDF de la factura).
//
// El archivo vive en Firebase Storage; en la BD solo se guarda su URL de
// descarga, en el NODO MOVIMIENTO:
//   /shared/cajaChica/{obraId}/movimientos/{movId}.comprobanteUrl
// El item de buzón NO lo lleva (ver docs/CONTRATO-GASTOS.md §2 y §8).
//
// Ruta en Storage: comprobantes/{obraId}/{movimientoId}.{ext}
// Un comprobante por movimiento: el id del movimiento es el nombre del archivo,
// así que volver a subir sobre el mismo movimiento reemplaza el anterior.
//
// Los límites de aquí son un espejo de storage.rules (auth, 10 MB, image/* o
// application/pdf). Validar en el cliente es para dar un mensaje claro; quien
// manda es la regla del servidor.

import { ref as storageRef, uploadBytes, getDownloadURL }
  from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js';
import { storage } from './firebase.js';

export const MAX_BYTES = 10 * 1024 * 1024;      // 10 MB
export const ACCEPT_ATTR = 'image/*,application/pdf';

const EXT_POR_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif'
};
const EXT_IMAGEN = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'];

export function esTipoPermitido(file) {
  const t = (file?.type || '').toLowerCase();
  return t === 'application/pdf' || t.startsWith('image/');
}

// Devuelve un mensaje de error, o null si el archivo es válido.
export function validarComprobante(file) {
  if (!file) return null;                        // adjuntar es opcional
  if (!esTipoPermitido(file)) return 'Solo se aceptan imágenes o PDF.';
  if (file.size > MAX_BYTES) {
    return `El archivo pesa ${formatoTamano(file.size)}; el máximo es 10 MB.`;
  }
  return null;
}

export function formatoTamano(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Extensión del archivo: la del nombre si es sana, si no la del MIME.
export function extensionDe(file) {
  const porNombre = (file?.name || '').split('.').pop()?.toLowerCase() || '';
  if (/^[a-z0-9]{1,5}$/.test(porNombre) && porNombre !== (file?.name || '').toLowerCase()) {
    return porNombre;
  }
  return EXT_POR_MIME[(file?.type || '').toLowerCase()] || 'bin';
}

export function rutaComprobante(obraId, movimientoId, file) {
  return `comprobantes/${obraId}/${movimientoId}.${extensionDe(file)}`;
}

// Sube el comprobante y devuelve su URL de descarga.
// Lanza si el archivo no pasa la validación o si Storage rechaza la subida.
export async function subirComprobante(obraId, movimientoId, file) {
  const err = validarComprobante(file);
  if (err) throw new Error(err);
  const r = storageRef(storage, rutaComprobante(obraId, movimientoId, file));
  await uploadBytes(r, file, { contentType: file.type || 'application/octet-stream' });
  return await getDownloadURL(r);
}

// ¿La URL apunta a una imagen? Se decide por la extensión, que la controlamos
// nosotros al nombrar el archivo ({movId}.{ext}). Si falla, la vista cae al
// enlace genérico.
export function esUrlDeImagen(url) {
  const sinQuery = String(url || '').split('?')[0];
  const ext = decodeURIComponent(sinQuery).split('.').pop()?.toLowerCase() || '';
  return EXT_IMAGEN.includes(ext);
}
