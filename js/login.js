import { auth, signInWithEmailAndPassword, setPersistence, browserLocalPersistence, onAuthStateChanged } from "./firebase-config.js";

const loginForm = document.getElementById('login-form');

// --- ⚡ AUTO-LOGIN CHECK ---
// Agar user pehle se login hai, to use seedha home par bhej do
onAuthStateChanged(auth, (user) => {
    if (user) {
        window.location.href = "home.html";
    }
});

// "Remember Me" Fill logic
window.addEventListener('load', () => {
    const savedEmail = localStorage.getItem('remembered_email');
    const savedPass = localStorage.getItem('remembered_password');
    if (savedEmail && savedPass) {
        const emailField = document.getElementById('login-email');
        const passField = document.getElementById('login-password');
        const remCheck = document.getElementById('remember-me');
        if(emailField) emailField.value = savedEmail;
        if(passField) passField.value = savedPass;
        if(remCheck) remCheck.checked = true;
    }
});

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const rememberMe = document.getElementById('remember-me').checked;
        const btn = document.getElementById('login-btn');

        try {
            btn.innerText = "Verifying...";
            btn.disabled = true;

            // 1. Persistence Set (Session Storage Fix)
            await setPersistence(auth, browserLocalPersistence);

            // 2. Login
            await signInWithEmailAndPassword(auth, email, password);

            // 3. Remember Me Logic
            if (rememberMe) {
                localStorage.setItem('remembered_email', email);
                localStorage.setItem('remembered_password', password);
            } else {
                localStorage.removeItem('remembered_email');
                localStorage.removeItem('remembered_password');
            }

            localStorage.setItem('anvi_last_active', Date.now());
            window.location.href = "home.html";

        } catch (error) {
            btn.innerText = "Log In";
            btn.disabled = false;
            
            if(error.code === "auth/invalid-credential") {
                alert("Invalid Email or Password.");
            } else {
                alert("Login Failed: " + error.message);
            }
        }
    });
}
