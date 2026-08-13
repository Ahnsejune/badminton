import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD5fVie_uICaEmv-Q6qSc71PR8Nosc0rZw",
  authDomain: "badminton-ade92.firebaseapp.com",
  projectId: "badminton-ade92",
  storageBucket: "badminton-ade92.firebasestorage.app",
  messagingSenderId: "697398909157",
  appId: "1:697398909157:web:95b6309ac7b6b1aa359c0c",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
