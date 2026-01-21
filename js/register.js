import { auth, db, createUserWithEmailAndPassword, doc, setDoc, collection, addDoc, query, where, getDocs, updateDoc, increment } from "./firebase-config.js";

const registerForm = document.getElementById('register-form');

if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('register-name').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const referCodeInput = document.getElementById('register-refer').value.trim();
        const btn = document.getElementById('register-btn');

        // --- 🛑 SECURITY 1: DEVICE CHECK ---
        if (localStorage.getItem('anvi_device_used')) {
            alert("⚠️ Warning: Multiple accounts are not allowed on the same device!");
            return;
        }

        if (password.length < 6) {
            alert("Password must be at least 6 characters!");
            return;
        }

        try {
            btn.innerText = "Processing...";
            btn.disabled = true;

            // 1. Create User in Firebase Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            // Unique Referral Code for New User
            const myUniqueCode = "ANVI" + Math.floor(10000 + Math.random() * 90000);
            let referrerId = null;

            // --- REFERRAL LOGIC START ---
            if (referCodeInput !== "") {
                const q = query(collection(db, "users"), where("myReferCode", "==", referCodeInput));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const referrerDoc = querySnapshot.docs[0];
                    referrerId = referrerDoc.id;
                    const referrerData = referrerDoc.data();

                    // --- 🛑 SECURITY 2: DAILY LIMIT CHECK ---
                    const todayStr = new Date().toISOString().split('T')[0];
                    let currentDailyCount = referrerData.todayReferCount || 0;
                    let lastDate = referrerData.lastReferDate || "";

                    if (lastDate !== todayStr) {
                        currentDailyCount = 0;
                    }

                    // Daily Limit: 10 Referrals
                    if (currentDailyCount < 10) {
                        // A. Referrer Reward
                        await updateDoc(doc(db, "users", referrerId), {
                            balance: increment(100),
                            totalReferrals: increment(1),
                            referIncome: increment(100),
                            todayReferCount: currentDailyCount + 1,
                            lastReferDate: todayStr
                        });

                        // B. Referrer's History
                        await addDoc(collection(db, "users", referrerId, "my_referrals"), {
                            name: name,
                            date: new Date().toISOString(),
                            earnings: 100
                        });

                        // C. Wallet Transaction for Referrer
                        await addDoc(collection(db, "users", referrerId, "transactions"), {
                            title: "Referral Bonus",
                            description: "Bonus for referring " + name,
                            amount: 100,
                            type: "credit",
                            date: new Date().toISOString()
                        });

                        // D. Notification for Referrer
                        await addDoc(collection(db, "users", referrerId, "notifications"), {
                            title: "New Referral!",
                            message: `Congrats! You earned 100 coins for referring ${name}.`,
                            type: "success",
                            read: false,
                            date: new Date().toISOString()
                        });

                    } else {
                        console.log("Referrer daily limit reached.");
                    }
                }
            }
            // --- REFERRAL LOGIC END ---

            // 2. Save New User to Database
            await setDoc(doc(db, "users", user.uid), {
                fullName: name,
                email: email,
                balance: 100, // Welcome Bonus
                myReferCode: myUniqueCode,
                referredBy: referrerId,
                totalReferrals: 0,
                referIncome: 0,
                todayReferCount: 0,
                lastReferDate: new Date().toISOString().split('T')[0],
                createdAt: new Date().toISOString()
            });

            // 3. New User Welcome History
            await addDoc(collection(db, "users", user.uid, "transactions"), {
                title: "Joining Bonus",
                description: "Welcome reward for joining AnviPayz",
                amount: 100,
                type: "credit",
                date: new Date().toISOString()
            });

            // 4. Welcome Notification
            await addDoc(collection(db, "users", user.uid, "notifications"), {
                title: "Welcome to AnviPayz",
                message: "You received 100 Coins as a joining bonus. Start earning now!",
                type: "info",
                read: false,
                date: new Date().toISOString()
            });

            // --- 🛑 SECURITY 3: MARK DEVICE ---
            localStorage.setItem('anvi_device_used', 'true');

            alert("Account Created Successfully!");
            window.location.href = "home.html";

        } catch (error) {
            console.error(error);
            btn.innerText = "Create Account";
            btn.disabled = false;
            alert("Error: " + error.message);
        }
    });
}

// --- 🛠️ AUTO-FILL REFER CODE FROM URL ---
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const autoCode = urlParams.get('ref'); 
    
    if (autoCode) {
        const referInput = document.getElementById('register-refer');
        if (referInput) {
            referInput.value = autoCode.toUpperCase();
            console.log("Referral code auto-filled:", autoCode);
            // Optionally make it read-only: referInput.readOnly = true;
        }
    }
});
