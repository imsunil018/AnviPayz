import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,    // ✅ 1. YAHAN IMPORT KIYA
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

// Aapki App Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCESmNhN_Ct-kOFVW8rk6_lu_XDA4ASxbU",
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

// Export (Taaki baaki files use kar sakein)
export {
  auth, db,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut,
  doc,
  setDoc,    // ✅ 2. YAHAN EXPORT KIYA (Ab Tasks.js isko use kar payega)
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