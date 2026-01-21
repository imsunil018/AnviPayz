// 1. Auth object lao apni config file se
import { auth } from "./firebase-config.js";

// 2. 🛠️ FIX: Baaki saare tools seedha Firebase URL se import karo
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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

            // --- 🛠️ FIX: Ab ye line chalegi ---
            // Browser ko force karo ki wo login yaad rakhe
            await setPersistence(auth, browserLocalPersistence);

            // Ab Login karo
            await signInWithEmailAndPassword(auth, email, password);

            // Time note kar lo
            localStorage.setItem('anvi_last_active', Date.now());

            // Success Redirect
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
