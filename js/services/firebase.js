import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js';
import { firebaseConfig } from '../config/firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
// Bucket ya declarado en firebaseConfig.storageBucket. Hoy solo lo usan los
// comprobantes de caja chica (ver js/services/comprobantes.js).
export const storage = getStorage(app);
export { firebaseConfig };
