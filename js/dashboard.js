import { auth, db, onAuthStateChanged, doc, getDoc, signOut, collection, query, orderBy, limit, getDocs } from "./firebase-config.js";

onAuthStateChanged(auth, async (user) => {
    if (user) {
        
        // --- ✨ 3-DAY INACTIVITY CHECK: START ---
        const lastActiveTime = localStorage.getItem('anvi_last_active');
        const currentTime = Date.now();
        const threeDaysInMs = 3 * 24 * 60 * 60 * 1000; // 3 Din (Milliseconds mein)

        if (lastActiveTime) {
            const diff = currentTime - parseInt(lastActiveTime);

            // Agar 3 din se zyada ho gaya hai (Session Expired)
            if (diff > threeDaysInMs) {
                alert("⚠️ Session Expired: You haven't opened the app in 3 days. Please login again.");
                
                await signOut(auth); // Firebase se logout
                localStorage.removeItem('anvi_last_active'); // Time hatao
                window.location.href = "index.html"; // Login page par bhejo
                return; // Code yahin rok do, aage data load mat karo
            }
        }

        // Agar user active hai, to Time Update kar do (Reset Timer)
        // Iska matlab jab tak wo roz app kholta rahega, kabhi logout nahi hoga.
        localStorage.setItem('anvi_last_active', currentTime);
        // --- ✨ 3-DAY CHECK: END ---


        // User Valid hai, ab Data Load karo
        updateUserData(user.uid);
        loadRecentHistory(user.uid);

    } else {
        const path = window.location.pathname;
        if (!path.includes("index.html") && !path.includes("register.html")) {
            window.location.href = "index.html";
        }
    }
});

async function updateUserData(uid) {
    try {
        const userSnap = await getDoc(doc(db, "users", uid));
        if (userSnap.exists()) {
            const data = userSnap.data();

            // 1. Name Update
            const nameEl = document.getElementById('user-name');
            if (nameEl) nameEl.innerText = data.fullName ? data.fullName.split(' ')[0] : "User";

            // 2. Total Balance
            document.querySelectorAll('.amount').forEach(el => el.innerText = data.balance || 0);
            const idBalance = document.getElementById('user-balance');
            if (idBalance) idBalance.innerText = data.balance || 0;

            // 3. Refer Count
            const referIncEl = document.getElementById('refer-income');
            if (referIncEl) {
                referIncEl.innerText = data.totalReferrals || 0;
                const label = referIncEl.previousElementSibling?.querySelector('.stat-label');
                if(label) label.innerText = "Total Refers"; 
            }

            // 4. Task Count
            const taskIncEl = document.getElementById('task-income');
            if (taskIncEl) {
                taskIncEl.innerText = data.totalTasks || 0;
                const label = taskIncEl.previousElementSibling?.querySelector('.stat-label');
                if(label) label.innerText = "Tasks Done";
            }
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
            <div class="list-item">
                <div class="list-icon" style="background: ${isCredit ? '#d1fae5' : '#fee2e2'}; color: ${color};">
                    <i class="${isCredit ? 'ri-arrow-down-line' : 'ri-arrow-up-line'}"></i>
                </div>
                <div class="list-info">
                    <div class="list-title">${item.title}</div>
                    <div class="list-sub">${item.description}</div>
                </div>
                <div style="text-align: right;">
                    <div class="list-amount" style="color: ${color};">${sign}${item.amount}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${dateStr}</div>
                </div>
            </div>`;
        });
        
        html += `<div style="text-align:center; margin-top:10px;"><a href="wallet.html" style="color:var(--primary); font-size:0.9rem;">View All</a></div>`;
        historyContainer.innerHTML = html;

    } catch (error) {
        console.error(error);
    }
}

const logoutBtn = document.querySelector('a[href="index.html"]');
if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if(confirm("Logout?")) signOut(auth).then(() => {
            // Logout par time clear kar do
            localStorage.removeItem('anvi_last_active'); 
            window.location.href = "index.html";
        });
    });
}