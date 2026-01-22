import { auth, db, onAuthStateChanged, doc, setDoc, increment, collection, addDoc, query, where, getDocs } from "./firebase-config.js";

const wheel = document.getElementById('wheel');
const spinBtn = document.getElementById('btn-spin');
const spinMsg = document.getElementById('spin-msg');

// Prizes map (Angle ke hisab se)
// Wheel me 8 sections hain (360 / 8 = 45 degrees each)
// Order colors ke hisab se: Red, Blue, Green...
const segments = [
    { color: 'Red', value: 0 },      // Better luck next time
    { color: 'Blue', value: 50 },
    { color: 'Green', value: 10 },
    { color: 'Yellow', value: 100 }, // Jackpot
    { color: 'Purple', value: 5 },
    { color: 'Pink', value: 20 },
    { color: 'Teal', value: 0 },
    { color: 'Orange', value: 30 }
];

onAuthStateChanged(auth, async (user) => {
    if (user) {
        checkSpinLimit(user.uid);
    } else {
        window.location.href = "index.html";
    }
});

// 1. Check if User Spun Today
async function checkSpinLimit(uid) {
    const todayStr = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });

    const q = query(
        collection(db, "users", uid, "task_history"), 
        where("taskId", "==", "spin_wheel"),
        where("dateStr", "==", todayStr)
    );
    
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
        // Limit Reached
        spinBtn.disabled = true;
        spinBtn.innerText = "Come Back Tomorrow";
        spinMsg.innerText = "✅ You have used your daily spin.";
        spinMsg.style.color = "#10b981";
    } else {
        // Allow Spin
        spinBtn.addEventListener('click', () => startSpin(uid));
    }
}

// 2. Spin Logic
async function startSpin(uid) {
    spinBtn.disabled = true;
    spinMsg.innerText = "Spinning...";

    // Random rotation (Extra 5-10 rounds + random angle)
    const randomDeg = Math.floor(2000 + Math.random() * 2000); 
    
    // Rotate Wheel
    wheel.style.transform = `rotate(${randomDeg}deg)`;

    // Calculate Result after animation stops (4 seconds)
    setTimeout(() => {
        calculatePrize(uid, randomDeg);
    }, 4000);
}

// 3. Calculate Reward
async function calculatePrize(uid, actualDeg) {
    // Normalize degree (0-360 ke beech laao)
    const deg = actualDeg % 360;
    
    // Wheel CSS rotation clockwise hai, lekin pointer upar hai.
    // Calculation thoda tricky hota hai, isliye hum approximate value lenge.
    // Simple logic: Reverse calculation.
    
    const segmentSize = 45;
    // Pointer is at Top (0 deg visual), but rotation moves content.
    // Effectively, index = floor((360 - deg + offset) / 45)
    
    let index = Math.floor((360 - deg + 22.5) / segmentSize) % 8;
    const prize = segments[index];

    // --- REWARD LOGIC ---
    const reward = prize.value;
    const todayStr = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });

    if (reward > 0) {
        // Update DB
        await setDoc(doc(db, "users", uid), {
            balance: increment(reward),
            taskIncome: increment(reward),
            totalTasks: increment(1)
        }, { merge: true });

        // Add History
        await addDoc(collection(db, "users", uid, "task_history"), {
            taskId: "spin_wheel",
            title: "Spin Wheel Reward",
            reward: reward,
            date: new Date().toISOString(),
            dateStr: todayStr
        });

        // Transaction
        await addDoc(collection(db, "users", uid, "transactions"), {
            title: "Spin Win",
            description: "Won from Lucky Wheel",
            amount: reward,
            type: "credit",
            date: new Date().toISOString()
        });

        spinMsg.innerText = `🎉 You Won ${reward} Coins!`;
        spinMsg.style.color = "#10b981";
        alert(`Congratulations! You won ${reward} Coins.`);
        
    } else {
        // 0 Coins (Better luck next time)
        // History me record karna padega taaki limit count ho jaye
        await addDoc(collection(db, "users", uid, "task_history"), {
            taskId: "spin_wheel",
            title: "Spin Wheel (No Luck)",
            reward: 0,
            date: new Date().toISOString(),
            dateStr: todayStr
        });

        spinMsg.innerText = "😐 Better luck next time!";
        spinMsg.style.color = "#ef4444";
        alert("Oops! Better luck next time.");
    }

    spinBtn.innerText = "Come Back Tomorrow";
}


  // ... calculatePrize function ke andar niche wala part update karein
const navContainer = document.getElementById('back-nav-container');
if (navContainer) {
    navContainer.innerHTML = `
        <button onclick="window.location.href='tasks.html'" class="btn-primary desktop-only-btn back-tasks-btn">
            <i class="ri-arrow-left-line"></i> Back to Tasks
        </button>
    `;
}

