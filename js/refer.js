import { auth, db, onAuthStateChanged, doc, getDoc, updateDoc, collection, query, orderBy, getDocs } from "./firebase-config.js";

// Auth Check
onAuthStateChanged(auth, async (user) => {
    if (user) {
        loadReferralStats(user.uid);
        loadReferralList(user.uid);
    } else {
        window.location.href = "index"; // Clean URL use karein
    }
});

// 1. Load Stats (Earnings + Daily Limit)
async function loadReferralStats(uid) {
    try {
        const userRef = doc(db, "users", uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            const data = userDoc.data();
            let myCode = data.myReferCode;

            // SELF REPAIR: Code missing hai to generate karo
            if (!myCode) {
                myCode = "ANVI" + Math.floor(10000 + Math.random() * 90000);
                await updateDoc(userRef, { myReferCode: myCode });
            }

            // --- UI Updates ---
            const codeEl = document.getElementById('my-refer-code');
            if (codeEl) codeEl.innerText = myCode;

            const countEl = document.getElementById('total-ref-count');
            if(countEl) countEl.innerText = data.totalReferrals || 0;

            const earningsEl = document.getElementById('total-ref-earnings');
            const income = data.referIncome || ((data.totalReferrals || 0) * 100);
            if(earningsEl) earningsEl.innerText = income;

            // DAILY LIMIT logic
            const todayStr = new Date().toISOString().split('T')[0];
            let dailyCount = data.todayReferCount || 0;
            if (data.lastReferDate !== todayStr) dailyCount = 0;

            const dailyEl = document.getElementById('daily-limit-text');
            if (dailyEl) {
                dailyEl.innerText = `${dailyCount} / 10 Today`;
                if (dailyCount >= 10) {
                    dailyEl.style.color = "red";
                    dailyEl.innerText = "Limit Reached (10/10)";
                }
            }
        }
    } catch (error) {
        console.error("Stats Error:", error);
    }
}

// 2. Load List (History) - Same as your code
async function loadReferralList(uid) {
    const listContainer = document.getElementById('referral-list');
    if (!listContainer) return;
    try {
        const q = query(collection(db, "users", uid, "my_referrals"), orderBy("date", "desc"));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            listContainer.innerHTML = `<div style="text-align: center; padding: 2rem; color: #999;">No referrals yet</div>`;
            return;
        }
        let html = "";
        querySnapshot.forEach((doc) => {
            const item = doc.data();
            const dateStr = new Date(item.date).toLocaleDateString();
            html += `
            <div class="list-item">
                <div class="list-icon" style="background: #e0e7ff; color: #4f46e5;"><i class="ri-user-smile-line"></i></div>
                <div class="list-info">
                    <div class="list-title" style="font-weight: 600;">${item.name}</div>
                    <div class="list-sub">Joined on ${dateStr}</div>
                </div>
                <div style="text-align: right;"><div class="list-amount" style="color: #10b981;">+${item.earnings}</div></div>
            </div>`;
        });
        listContainer.innerHTML = html;
    } catch (error) { console.error("List Error:", error); }
}

// 3. Button Logic (Copy & Share) - ✅ UPDATED FOR AUTO-FILL
const copyBtn = document.getElementById('copy-btn');
if (copyBtn) {
    copyBtn.addEventListener('click', () => {
        const codeText = document.getElementById('my-refer-code')?.innerText;
        if (!codeText || codeText.includes(".")) return;

        // Copying CLEAN LINK instead of just code
        const shareLink = `${window.location.origin}/register?ref=${codeText}`;
        navigator.clipboard.writeText(shareLink).then(() => {
            const original = copyBtn.innerHTML;
            copyBtn.innerHTML = `<i class="ri-check-line"></i> Link Copied`;
            setTimeout(() => copyBtn.innerHTML = original, 2000);
        });
    });
}

const shareBtn = document.getElementById('share-btn');
if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
        const codeText = document.getElementById('my-refer-code')?.innerText;
        if (!codeText || codeText.includes(".")) return;

        // ✅ AUTO-FILL LINK GENERATION
        const cleanURL = window.location.origin + "/register?ref=" + codeText;
        
        const shareData = {
            title: 'Join AnviPayz',
            text: `Hey! Join AnviPayz & earn daily rewards. 💰 Use my code: ${codeText} to get 100 Bonus Coins! 🎁`,
            url: cleanURL
        };

        if (navigator.share) {
            try { await navigator.share(shareData); } catch (err) {}
        } else {
            const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareData.text + " " + shareData.url)}`;
            window.open(waUrl, '_blank');
        }
    });
}