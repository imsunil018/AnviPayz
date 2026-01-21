import { auth, db, onAuthStateChanged, doc, setDoc, increment, collection, addDoc, query, where, getDocs, orderBy, getDoc } from "./firebase-config.js";

onAuthStateChanged(auth, async (user) => {
    if (user) {
        checkDailyStatus(user.uid);
        checkVideoLimit(user.uid); // Check video limit on load
        loadTaskStats(user.uid);
        loadTaskHistory(user.uid);
        setupButtons(user.uid);
    } else {
        window.location.href = "index.html";
    }
});

// Helper: Get today's date string in India Time (IST)
function getIndiaDateString() {
    return new Date().toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });
}

// Helper: Get milliseconds until next midnight IST
function getTimeUntilMidnightIST() {
    const now = new Date();
    // Create date object for current time in IST
    const nowIST = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    
    // Create date object for next midnight in IST
    const nextMidnight = new Date(nowIST);
    nextMidnight.setHours(24, 0, 0, 0); // Set to 12:00 AM next day
    
    // Calculate difference (approximate)
    // Note: To be precise with timezone conversion back to local timestamp:
    const targetTime = new Date(now.getTime() + (nextMidnight.getTime() - nowIST.getTime()));
    return targetTime - now;
}

// Helper: Start Countdown Timer on Button
function startResetTimer(btnElement) {
    // Update timer every second
    const updateTimer = () => {
        const msLeft = getTimeUntilMidnightIST();
        
        if (msLeft <= 0) {
            btnElement.innerText = "Reload Page";
            btnElement.disabled = false;
            return;
        }

        // Convert to hours, minutes, seconds
        const h = Math.floor((msLeft / (1000 * 60 * 60)) % 24);
        const m = Math.floor((msLeft / (1000 * 60)) % 60);
        const s = Math.floor((msLeft / 1000) % 60);

        btnElement.innerText = `Wait ${h}h ${m}m ${s}s`;
    };

    updateTimer(); // Run once immediately
    setInterval(updateTimer, 1000); // Update every second
}

// 1. Check Daily Check-in Status
async function checkDailyStatus(uid) {
    const btn = document.getElementById('btn-daily-checkin');
    const todayStr = getIndiaDateString();

    try {
        const q = query(
            collection(db, "users", uid, "task_history"), 
            where("taskId", "==", "daily_checkin"),
            where("dateStr", "==", todayStr)
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            btn.disabled = true;
            btn.style.opacity = "0.6";
            btn.style.cursor = "not-allowed";
            // Start Countdown
            startResetTimer(btn);
        }
    } catch (error) {
        console.error("Daily Check Error:", error);
    }
}

// 2. Check Watch Video Limit (Max 3 per day)
async function checkVideoLimit(uid) {
    const btn = document.getElementById('btn-watch-video');
    const todayStr = getIndiaDateString();

    try {
        const q = query(
            collection(db, "users", uid, "task_history"), 
            where("taskId", "==", "watch_video"),
            where("dateStr", "==", todayStr)
        );
        const snapshot = await getDocs(q);

        // Count how many times watched today
        const watchedCount = snapshot.size;
        const maxLimit = 3;

        // Update Button Text (e.g., "Start (1/3)")
        if (watchedCount < maxLimit) {
            btn.innerText = `Start (${watchedCount}/${maxLimit})`;
        } else {
            // Limit Reached
            btn.disabled = true;
            btn.style.opacity = "0.6";
            btn.style.cursor = "not-allowed";
            startResetTimer(btn); // Show timer
        }
    } catch (error) {
        console.error("Video Check Error:", error);
    }
}

// 3. Button Click Logics
function setupButtons(uid) {
    
    // --- DAILY CHECK IN ---
    const dailyBtn = document.getElementById('btn-daily-checkin');
    if(dailyBtn) {
        dailyBtn.addEventListener('click', async () => {
            try {
                dailyBtn.innerText = "Processing...";
                dailyBtn.disabled = true;

                const reward = 10;
                const todayStr = getIndiaDateString();

                await setDoc(doc(db, "users", uid), {
                    balance: increment(reward),
                    taskIncome: increment(reward),
                    totalTasks: increment(1)
                }, { merge: true });

                await addDoc(collection(db, "users", uid, "task_history"), {
                    taskId: "daily_checkin",
                    title: "Daily Check-in",
                    reward: reward,
                    date: new Date().toISOString(),
                    dateStr: todayStr
                });

                await addDoc(collection(db, "users", uid, "transactions"), {
                    title: "Task Reward",
                    description: "Daily Login Bonus",
                    amount: reward,
                    type: "credit",
                    date: new Date().toISOString()
                });

                await addDoc(collection(db, "users", uid, "notifications"), {
                    title: "Daily Bonus Claimed",
                    message: `You earned ${reward} coins for daily login!`,
                    type: "success",
                    read: false,
                    date: new Date().toISOString()
                });

                alert(`Success! You earned ${reward} coins.`);
                location.reload(); 

            } catch (error) {
                console.error(error);
                dailyBtn.innerText = "Claim";
                dailyBtn.disabled = false;
                alert("Error: " + error.message);
            }
        });
    }

    // --- WATCH VIDEO TASK ---
    const videoBtn = document.getElementById('btn-watch-video');
    if(videoBtn) {
        videoBtn.addEventListener('click', async () => {
            
            // Re-check limit before starting (Double safety)
            const todayStr = getIndiaDateString();
            const q = query(collection(db, "users", uid, "task_history"), where("taskId", "==", "watch_video"), where("dateStr", "==", todayStr));
            const snapshot = await getDocs(q);
            
            if(snapshot.size >= 3) {
                alert("Daily limit reached! Come back tomorrow.");
                location.reload();
                return;
            }

            if(confirm("Watch a 10-second ad to earn 20 Coins?")) {
                videoBtn.disabled = true;
                let timeLeft = 10;
                
                const timer = setInterval(() => {
                    videoBtn.innerText = `Watching... ${timeLeft}s`;
                    timeLeft--;

                    if (timeLeft < 0) {
                        clearInterval(timer);
                        completeVideoTask(uid, videoBtn);
                    }
                }, 1000);
            }
        });
    }
}

// Video Complete Hone par
async function completeVideoTask(uid, btn) {
    try {
        btn.innerText = "Adding Coins...";
        const reward = 20;
        const todayStr = getIndiaDateString();

        await setDoc(doc(db, "users", uid), { 
            balance: increment(reward),
            taskIncome: increment(reward),
            totalTasks: increment(1)
        }, { merge: true });

        await addDoc(collection(db, "users", uid, "task_history"), {
            taskId: "watch_video",
            title: "Watch Tutorial",
            reward: reward,
            date: new Date().toISOString(),
            dateStr: todayStr
        });

        await addDoc(collection(db, "users", uid, "transactions"), {
            title: "Task Reward",
            description: "Watched Tutorial Video",
            amount: reward,
            type: "credit",
            date: new Date().toISOString()
        });

        alert("Thanks for watching! +20 Coins added.");
        location.reload();

    } catch (error) {
        console.error(error);
        btn.innerText = "Start";
        btn.disabled = false;
        alert("Error: " + error.message);
    }
}

// 4. Load Stats (Total Earned & Completed)
async function loadTaskStats(uid) {
    try {
        const q = query(collection(db, "users", uid, "task_history"));
        const snapshot = await getDocs(q);

        let totalEarned = 0;
        let completedCount = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            totalEarned += (data.reward || 0);
            completedCount++;
        });

        const earnedEl = document.getElementById('task-total-earned');
        if(earnedEl) earnedEl.innerText = totalEarned;

        const completeEl = document.getElementById('task-completed-count');
        if(completeEl) completeEl.innerText = completedCount;

    } catch (error) {
        console.error("Stats Error:", error);
    }
}

// 5. Load History List
async function loadTaskHistory(uid) {
    const listContainer = document.getElementById('task-history-list');
    
    try {
        const q = query(collection(db, "users", uid, "task_history"), orderBy("date", "desc"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            listContainer.innerHTML = `<div style="text-align:center; padding:1rem; color:#999;">No tasks completed yet.</div>`;
            return;
        }

        let html = "";
        snapshot.forEach(doc => {
            const item = doc.data();
            
            html += `
            <div class="card task-completed" style="margin-bottom:0;">
                <div class="list-item" style="border:none; padding:0;">
                    <div class="list-icon" style="background: rgba(107, 114, 128, 0.1); color: var(--text-muted);">
                        <i class="ri-checkbox-circle-line"></i>
                    </div>
                    <div class="list-info">
                        <div class="list-title">${item.title}</div>
                        <div class="list-sub">Earned ${item.reward} coins</div>
                    </div>
                    <button style="padding: 6px 16px; background: transparent; border: 1px solid var(--border); color: var(--text-muted); border-radius: 8px; font-weight:600; font-size: 0.85rem; cursor: not-allowed;">
                        <i class="ri-check-line"></i> Done
                    </button>
                </div>
            </div>`;
        });

        listContainer.innerHTML = html;
    } catch (error) {
        console.error("History Error:", error);
    }
}