import { auth, signInWithEmailAndPassword } from "./firebase-config.js";

const loginForm = document.getElementById('login-form');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('login-email').value.trim(); // Extra space hatane ke liye trim()
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');

    try {
        // 1. Security: Button disable karo taaki user baar baar click na kare
        btn.innerText = "Verifying...";
        btn.style.opacity = "0.7";
        btn.disabled = true;

        // 2. Firebase check
        await signInWithEmailAndPassword(auth, email, password);
        
        // 3. Success -> Redirect
        window.location.href = "home.html";

    } catch (error) {
        console.error("Login Error:", error);
        
        // Reset Button
        btn.innerText = "Log In";
        btn.style.opacity = "1";
        btn.disabled = false;

        // Human readable errors
        if(error.code === "auth/invalid-credential" || error.code === "auth/user-not-found" || error.code === "auth/wrong-password") {
            alert("Incorrect Email or Password.");
        } else if (error.code === "auth/too-many-requests") {
            alert("Too many failed attempts. Please try again later.");
        } else {
            alert("Error: " + error.message);
        }
    }
});