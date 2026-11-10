import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { emulatorConfig } from "./emulatorConfig";

// Firebase App config, loaded from VITE_FIREBASE_* env vars (see .env.example).
//  dev  -> .env.development (+ .env.local overrides), prod -> .env.production
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  // optional, only needed if you use Firebase Analytics
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
  // optional, only needed if you use Firebase Realtime Database
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
};

for (const key of ["apiKey", "projectId", "appId"] as const) {
  if (!firebaseConfig[key]) {
    throw new Error(`Missing Firebase config "${key}". Set VITE_FIREBASE_* vars (see .env.example).`);
  }
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

if (emulatorConfig.enabled) {
  const { firestore, auth: authEmu } = emulatorConfig;
  connectFirestoreEmulator(db, firestore.host, firestore.port);
  connectAuthEmulator(auth, `http://${authEmu.host}:${authEmu.port}`, { disableWarnings: true });
}
