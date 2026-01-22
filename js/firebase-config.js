import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  setPersistence,           // ✅ Naya tool add kiya
  browserLocalPersistence   // ✅ Naya tool add kiya
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  increment,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ✅ AAPKI NEW UPDATED CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyCYPHQN5fbIb2pXZyxtx9UDwQ5SBgvJ3Yk", // Nayi restricted key
  authDomain: "anvipayz-7f367.firebaseapp.com",
  projectId: "anvipayz-7f367",
  storageBucket: "anvipayz-7f367.firebasestorage.app",
  messagingSenderId: "626938499016",
  appId: "1:626938499016:web:00e560470981be419d3afd"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Export sab ek saath
export {
  auth, db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  setPersistence,           // ✅ Export kiya taaki login.js use kar sake
  browserLocalPersistence,   // ✅ Export kiya taaki login.js use kar sake
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  increment,
  orderBy,
  limit
};