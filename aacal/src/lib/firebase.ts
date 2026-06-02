import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";

// Firebase App config 
//  fill it with real values in project settings in Firebase console
const firebaseConfig = {
  apiKey: "AIzaSyAsR1PWiYiaEQMW8fFHdbTReLmwvWMNchU",
  authDomain: "zol.firebaseapp.com",
  projectId: "zol",
  storageBucket: "zol.firebasestorage.app",
  messagingSenderId: "880585555851",
  appId: "1:880585555851:web:4b44e2f69d5c173940b98e",
  // optional, only needed if you use Firebase Analytics
  measurementId: "G-628H9DVDKB",
  // optional, only needed if you use Firebase Realtime Database
  // databaseURL: "https://zol-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
  connectFirestoreEmulator(db, "127.0.0.1", 5703);
  connectAuthEmulator(auth, "http://localhost:5705", { disableWarnings: true });
}
