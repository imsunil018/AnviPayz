import { auth, db, onAuthStateChanged, doc, getDoc, signOut, collection, query, orderBy, limit, getDocs } from "./firebase-config.js";

// --- ⚡ SECURITY GATEKEEPER: START ---
// Jab tak Firebase check na kar le, tab tak content mat dikhao
document.body.style.opacity = "0"; 

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // --- ✨ 3-DAY INACTIVITY CHECK ---
        const lastActiveTime = localStorage.getItem('anvi_last_active');
        const currentTime = Date.now();
        const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;

        if (lastActiveTime && (currentTime - parseInt(lastActiveTime) > threeDaysInMs)) {
            alert("⚠️ Session Expired. Please login again.");
            await signOut(auth);
            localStorage.removeItem('anvi_last_active');
            window.location.href = "index.html";
            return;
        }

        localStorage.setItem('anvi_last_active', currentTime);
        
        // Sab kuch sahi hai, ab screen dikhao
        document.body.style.opacity = "1";
        document.body.style.transition = "opacity 0.3s ease";

        // Data Load karo
        updateUserData(user.uid);
        loadRecentHistory(user.uid);

    } else {
        // Agar user login nahi hai aur kisi dashboard page par hai
        const path = window.location.pathname;
        if (!path.includes("index.html") && !path.includes("register.html")) {
            window.location.href = "index.html";
        }
    }
});
// --- ⚡ SECURITY GATEKEEPER: END ---

async function updateUserData(uid) {
    try {
        const userSnap = await getDoc(doc(db, "users", uid));
        if (userSnap.exists()) {
            const data = userSnap.data();
            
            // UI Updates (Safe check ke sath)
            const nameEl = document.getElementById('user-name');
            if (nameEl) nameEl.innerText = data.fullName ? data.fullName.split(' ')[0] : "User";

            document.querySelectorAll('.amount').forEach(el => el.innerText = data.balance || 0);
            
            const referIncEl = document.getElementById('refer-income');
            if (referIncEl) referIncEl.innerText = data.totalReferrals || 0;

            const taskIncEl = document.getElementById('task-income');
            if (taskIncEl) taskIncEl.innerText = data.totalTasks || 0;
        }
    } catch (error) {
        console.error("Dashboard Error:", error);
    }
}

async function loadRecentHistory(uid) {
    const historyContainer = document.getElementById('recent-history');
    if (!historyContainer) return;

    try {
        const q = query(
            collection(db, "users", uid, "transactions"), 
            orderBy("date", "desc"), 
            limit(3)
        );
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            historyContainer.innerHTML = `<div style="padding:20px; text-align:center; color:#999;">No history yet</div>`;
            return;
        }

        let html = "";
        querySnapshot.forEach((doc) => {
            const item = doc.data();
            const dateStr = new Date(item.date).toLocaleDateString();
            const isCredit = item.type === 'credit';
            const color = isCredit ? '#10b981' : '#ef4444';
            const sign = isCredit ? '+' : '-';

            html += `
            <div class="list-item" style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid var(--border);">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="list-icon" style="background: ${isCredit ? '#d1fae5' : '#fee2e2'}; color: ${color}; width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center;">
                        <i class="${isCredit ? 'ri-arrow-down-line' : 'ri-arrow-up-line'}"></i>
                    </div>
                    <div>
                        <div class="list-title" style="font-weight:600; font-size:0.95rem;">${item.title}</div>
                        <div class="list-sub" style="font-size:0.8rem; color:var(--text-muted);">${item.description}</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div class="list-amount" style="color: ${color}; font-weight:700;">${sign}${item.amount}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${dateStr}</div>
                </div>
            </div>`;
        });
        
        html += `<div style="text-align:center; padding: 15px 0;"><a href="wallet.html" style="color:var(--primary); font-size:0.9rem; text-decoration:none; font-weight:600;">View All Transactions</a></div>`;
        historyContainer.innerHTML = html;

    } catch (error) {
        console.error("History Error:", error);
    }
}

// Logout Fix
const logoutBtn = document.querySelector('a[href="index.html"]');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if(confirm("Are you sure you want to logout?")) {
            await signOut(auth);
            localStorage.removeItem('anvi_last_active'); 
            window.location.href = "index.html";
        }
    });
}
