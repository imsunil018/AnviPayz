import { auth, db, onAuthStateChanged, doc, getDoc, collection, query, orderBy, getDocs } from "./firebase-config.js";

onAuthStateChanged(auth, async (user) => {
    if (user) {
        loadWalletStats(user.uid);
        loadTransactionHistory(user.uid);
    } else {
        window.location.href = "index.html";
    }
});

async function loadWalletStats(uid) {
    try {
        const userDoc = await getDoc(doc(db, "users", uid));
        
        if (userDoc.exists()) {
            const data = userDoc.data();
            
            // 1. Total Balance
            const balanceEl = document.getElementById('wallet-balance');
            if (balanceEl) balanceEl.innerText = data.balance || 0;

            // 2. Referrals Count (Ginti)
            const referEl = document.getElementById('wallet-refer-count');
            if (referEl) referEl.innerText = data.totalReferrals || 0;

            // 3. ✅ Tasks Count (Ginti) - Ye pehle nahi dikh raha tha
            const taskEl = document.getElementById('wallet-task-count');
            // Agar database me 'totalTasks' abhi nahi bana hai to 0 dikhao
            if (taskEl) taskEl.innerText = data.totalTasks || 0;
        }
    } catch (error) {
        console.error("Stats Error:", error);
    }
}

async function loadTransactionHistory(uid) {
    const listContainer = document.getElementById('transaction-list');
    if (!listContainer) return;

    try {
        const q = query(collection(db, "users", uid, "transactions"), orderBy("date", "desc"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            listContainer.innerHTML = `<div style="text-align: center; padding: 2rem; color: #999;">No transactions found</div>`;
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
        listContainer.innerHTML = html;
    } catch (error) {
        console.error(error);
        listContainer.innerHTML = "Failed to load history";
    }
}