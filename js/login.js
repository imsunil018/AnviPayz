// 1. Sab kuch apne local config file se import karein
import { 
    auth, 
    signInWithEmailAndPassword, 
    setPersistence, 
    browserLocalPersistence 
} from "./firebase-config.js";

const loginForm = document.getElementById('login-form');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const btn = document.getElementById('login-btn');

        try {
            // UI Feedback
            btn.innerText = "Verifying...";
            btn.style.opacity = "0.7";
            btn.disabled = true;

            // --- 🛠️ FIX: Persistence Set karo (Permanent Login) ---
            // Isse tab band karne par bhi logout nahi hoga
            await setPersistence(auth, browserLocalPersistence);

            // 2. Firebase Authentication
            await signInWithEmailAndPassword(auth, email, password);

            // 3. Time note kar lo (Inactivity check ke liye)
            localStorage.setItem('anvi_last_active', Date.now());

            // 4. Dashboard par bhejo
            window.location.href = "home.html";

        } catch (error) {
            console.error("Login Error:", error);
            
            // Reset Button on Failure
            btn.innerText = "Log In";
            btn.style.opacity = "1";
            btn.disabled = false;
            
            // User-friendly Error Messages
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

// login.js mein sabse upar ye load logic daalein
window.addEventListener('load', () => {
    const savedEmail = localStorage.getItem('remembered_email');
    const savedPass = localStorage.getItem('remembered_password');

    if (savedEmail && savedPass) {
        document.getElementById('login-email').value = savedEmail;
        document.getElementById('login-password').value = savedPass;
        document.getElementById('remember-me').checked = true;
    }
});

// Login Form Submit ke andar ye logic jodh dein
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('remember-me').checked;

    try {
        // Firebase Login Logic...
        // const userCredential = await signInWithEmailAndPassword(auth, email, password);

        // Success hone par ye check karein
        if (rememberMe) {
            localStorage.setItem('remembered_email', email);
            localStorage.setItem('remembered_password', password);
        } else {
            localStorage.removeItem('remembered_email');
            localStorage.removeItem('remembered_password');
        }

        window.location.href = "home"; // Clean URL
    } catch (error) {
        alert(error.message);
    }
});