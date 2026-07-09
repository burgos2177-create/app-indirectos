// Documentos de trabajadores (contratos laborales, identificaciones, etc.).
//
// Los archivos viven en un "Drive de documentos" de la suite SOGRUB. Esta app
// solo guarda METADATOS del documento (tipo, nombre, enlace) dentro del registro
// del empleado en /shared/indirectos/empleados/{id}/documentos/{docId}:
//   { tipo, nombre, url, fecha, subidoPor }
//
// La SUBIDA directa del archivo se hace a través de `subirDocumento`, que es el
// ÚNICO punto de integración con el Drive. Hoy está en modo "registrar por
// enlace" (el usuario sube el archivo al Drive y pega la URL). Cuando el Drive
// especial esté listo, se implementa aquí la subida real (Google Drive API o
// Firebase Storage) y todo lo demás sigue igual.

export const TIPOS_DOCUMENTO = [
  { id: 'contrato',  label: 'Contrato laboral' },
  { id: 'ine',       label: 'INE / identificación' },
  { id: 'curp',      label: 'CURP' },
  { id: 'rfc',       label: 'RFC / constancia fiscal' },
  { id: 'nss',       label: 'NSS / alta IMSS' },
  { id: 'domicilio', label: 'Comprobante de domicilio' },
  { id: 'cuenta',    label: 'Estado de cuenta / CLABE' },
  { id: 'aviso',     label: 'Aviso de retención / otros' },
  { id: 'otro',      label: 'Otro' }
];

// Configuración del Drive de documentos. Mientras `configurado` sea false, la
// app registra documentos por enlace y `subirDocumento` avisa que la subida
// directa aún no está conectada.
export const DRIVE_CONFIG = {
  configurado: false,
  // Cuando se defina el backend, llenar aquí lo necesario, p. ej.:
  // proveedor: 'google_drive' | 'firebase_storage',
  // folderId: '...',            // carpeta raíz del Drive de documentos laborales
  // basePath: 'documentos/empleados'
};

// Sube un archivo y devuelve { url, nombre, driveFileId? }.
// TODO(drive): implementar la subida real cuando DRIVE_CONFIG.configurado sea true.
export async function subirDocumento(file, { empleadoId, tipo } = {}) {
  if (!DRIVE_CONFIG.configurado) {
    throw new Error('La subida directa al Drive aún no está conectada. Sube el archivo al Drive de documentos y pega aquí su enlace.');
  }
  // Punto de integración: aquí irá la llamada real al Drive.
  throw new Error('subirDocumento: backend del Drive no implementado todavía.');
}

// Normaliza/valida un enlace de documento. Acepta cualquier URL http(s).
export function esUrlValida(url) {
  const s = (url || '').trim();
  return /^https?:\/\/.+/i.test(s);
}
