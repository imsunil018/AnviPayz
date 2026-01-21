// 1. Imports mein 'setPersistence' aur 'browserLocalPersistence' add karein
import { auth, signInWithEmailAndPassword, setPersistence, browserLocalPersistence } from "./firebase-config.js";

const loginForm = document.getElementById('login-form');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const btn = document.getElementById('login-btn');

        try {
            btn.innerText = "Verifying...";
            btn.style.opacity = "0.7";
            btn.disabled = true;

            // --- 🛠️ FIX: Forcefully Local Persistence Set karo ---
            // Ye line browser ko bolegi: "Tab band hone par bhi Login rakhna"
            await setPersistence(auth, browserLocalPersistence);

            // 2. Ab Login karo
            await signInWithEmailAndPassword(auth, email, password);

            // 3. Time note kar lo (3-Din wale logic ke liye)
            localStorage.setItem('anvi_last_active', Date.now());

            // 4. Success Redirect
            window.location.href = "home.html";

        } catch (error) {
            console.error("Login Error:", error);
            
            btn.innerText = "Log In";
            btn.style.opacity = "1";
            btn.disabled = false;
            
            if(error.code === "auth/invalid-credential" || error.code === "auth/user-not-found" || error.code === "auth/wrong-password") {
                alert("Incorrect Email or Password.");
            } else if (error.code === "auth/too-many-requests") {
                alert("Too many failed attempts. Please try again later.");
            } else {
                alert("Error: " + error.message);
            }
        }
    });
}
