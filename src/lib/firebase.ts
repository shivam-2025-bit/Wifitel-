import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

export const firebaseConfig = {
  apiKey: "AIzaSyB4XYPZU6d_9RgV4Lap_dx0faFpMzLXJCI",
  authDomain: "weifitel.firebaseapp.com",
  projectId: "weifitel",
  databaseURL: "https://weifitel-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "weifitel.firebasestorage.app",
  messagingSenderId: "264841039761",
  appId: "1:264841039761:web:ec1d661f6844e1f4511430"
};

const app = initializeApp(firebaseConfig);

// Health check: warn if appId looks truncated
if (firebaseConfig.appId.length < 20) {
  console.warn("Wifitel: Your appId looks truncated. Please provide the full App ID from Firebase Console.");
}

export const db = getDatabase(app);
export const auth = getAuth(app);
