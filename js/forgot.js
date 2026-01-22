import { auth, sendPasswordResetEmail } from "./firebase-config.js";

const forgotForm = document.getElementById('forgot-form');

forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('forgot-email').value;
    const btn = document.getElementById('forgot-btn');

    try {
        btn.innerText = "Sending...";
        btn.style.opacity = "0.7";
        btn.disabled = true;

        // Firebase Reset Logic
        await sendPasswordResetEmail(auth, email);

        // Success Message
        alert("Password reset link sent to your email! Check your inbox (and spam folder).");
        window.location.href = "index.html"; // Wapas login par bhejo

    } catch (error) {
        console.error(error);
        btn.innerText = "Send Reset Link";
        btn.style.opacity = "1";
        btn.disabled = false;

        if (error.code === "auth/user-not-found") {
            alert("Ye email registered nahi hai.");
        } else if (error.code === "auth/invalid-email") {
            alert("Email address sahi nahi hai.");
        } else {
            alert("Error: " + error.message);
        }
    }
});