// Firebase config — proyecto unificado sogrub-suite.
// Esta app escribe sus datos bajo /shared/indirectos/* y lee usuarios + obras
// desde /legacy/estimaciones/*. Lee catálogos OPUS de /shared/catalogos/{obraId}
// (solo lectura) cuando un gasto se carga a un conceptoKey específico.

export const firebaseConfig = {
  apiKey: "AIzaSyBjOrl1JW4Y383diRe4WO4rX5IF23UEN0k",
  authDomain: "sogrub-suite.firebaseapp.com",
  databaseURL: "https://sogrub-suite-default-rtdb.firebaseio.com",
  projectId: "sogrub-suite",
  storageBucket: "sogrub-suite.firebasestorage.app",
  messagingSenderId: "330378687274",
  appId: "1:330378687274:web:8be51640a6d9d7006ca453",
  measurementId: "G-98BM4PNBPP"
};

// Base path donde vive el dato propio de esta app dentro del RTDB compartido.
// Paths relativos en db.js se resuelven bajo este prefijo.
// Para escapes (lectura de /legacy/estimaciones/*, /shared/catalogos/*,
// /shared/buzon, /legacy/bitacora/*) usar paths con "/" inicial — se
// interpretan como absolutos.
export const APP_BASE_PATH = "shared/indirectos";
