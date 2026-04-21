import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB4XYPZU6d_9RgV4Lap_dx0faFpMzLXJCI",
  authDomain: "weifitel.firebaseapp.com",
  projectId: "weifitel",
  storageBucket: "weifitel.firebasestorage.app",
  messagingSenderId: "264841039761",
  appId: "1:264841039761"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
