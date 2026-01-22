/* js/app.js */

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Theme Toggle Logic ---
    const themeBtns = document.querySelectorAll('#theme-toggle, .mobile-theme-toggle');
    const html = document.documentElement;

    // Load saved theme
    const savedTheme = localStorage.getItem('anvi-theme') || 'light';
    html.setAttribute('data-theme', savedTheme);
    updateThemeIcons(savedTheme);

    themeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const currentTheme = html.getAttribute('data-theme');
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';

            html.setAttribute('data-theme', newTheme);
            localStorage.setItem('anvi-theme', newTheme);
            updateThemeIcons(newTheme);
        });
    });

    function updateThemeIcons(theme) {
        themeBtns.forEach(btn => {
            const icon = btn.querySelector('i');
            if (theme === 'dark') {
                icon.classList.remove('ri-moon-line');
                icon.classList.add('ri-sun-line');
            } else {
                icon.classList.remove('ri-sun-line');
                icon.classList.add('ri-moon-line');
            }
        });
    }

    // --- 2. Mobile Drawer Logic ---
    const menuBtn = document.getElementById('menu-btn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.overlay');

    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            sidebar.classList.add('open');
            overlay.classList.add('active');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }

    // --- 3. Active Nav State Highlighting ---
    const currentPath = window.location.pathname.split('/').pop();

    // Desktop Sidebar Links
    const navLinks = document.querySelectorAll('.nav-item');
    navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('active');
        }
    });

    // Mobile Bottom Nav Links
    const bottomLinks = document.querySelectorAll('.mobile-nav-item');
    bottomLinks.forEach(link => {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('active');
        }
    });

    // --- 4. Copy to Clipboard (Refer Page) ---
    const copyBtn = document.getElementById('copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const code = document.getElementById('refer-code').innerText;
            navigator.clipboard.writeText(code).then(() => {
                const originalText = copyBtn.innerText;
                copyBtn.innerText = 'Copied!';
                setTimeout(() => {
                    copyBtn.innerText = originalText;
                }, 2000);
            });
        });
    }
});

// js/dashboard.js ka logic
onAuthStateChanged(auth, (user) => {
    if (user) {
        // User login hai -> Badhiya, data dikhao
        console.log("User is logged in:", user.uid);
    } else {
        // User login nahi hai -> Wapas Login page par jao
        window.location.href = "index.html";
    }
});