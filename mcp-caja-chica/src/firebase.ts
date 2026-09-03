/**
 * Inicialización de firebase-admin (Database + Storage).
 *
 * Credenciales por GOOGLE_APPLICATION_CREDENTIALS (ruta al JSON de la cuenta de
 * servicio). No se aceptan credenciales inline ni por argumento: el proceso
 * corre bajo un cliente MCP y las claves no deben pasar por la conversación.
 */

import { initializeApp, applicationDefault, getApps, type App } from 'firebase-admin/app';
import { getDatabase, type Database } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';

export interface Config {
  databaseURL: string;
  storageBucket: string;
  autor: { uid: string; email: string | null; displayName: string | null };
}

function requerido(nombre: string): string {
  const v = (process.env[nombre] || '').trim();
  if (!v) {
    throw new Error(
      `Falta la variable de entorno ${nombre}. Revisa la sección "Configuración" del README.`,
    );
  }
  return v;
}

export function cargarConfig(): Config {
  requerido('GOOGLE_APPLICATION_CREDENTIALS');
  return {
    databaseURL: (
      process.env.FIREBASE_DATABASE_URL || 'https://sogrub-suite-default-rtdb.firebaseio.com'
    ).trim(),
    storageBucket: (
      process.env.FIREBASE_STORAGE_BUCKET || 'sogrub-suite.firebasestorage.app'
    ).trim(),
    autor: {
      uid: requerido('SOGRUB_AUTOR_UID'),
      email: (process.env.SOGRUB_AUTOR_EMAIL || '').trim() || null,
      displayName: (process.env.SOGRUB_AUTOR_NOMBRE || '').trim() || null,
    },
  };
}

let app: App | null = null;
let config: Config | null = null;

export function iniciar(): Config {
  if (config) return config;
  config = cargarConfig();
  app =
    getApps()[0] ??
    initializeApp({
      credential: applicationDefault(),
      databaseURL: config.databaseURL,
      storageBucket: config.storageBucket,
    });
  return config;
}

export function db(): Database {
  if (!app) iniciar();
  return getDatabase(app!);
}

export function bucket() {
  if (!app) iniciar();
  return getStorage(app!).bucket();
}

export function autor() {
  return iniciar().autor;
}
