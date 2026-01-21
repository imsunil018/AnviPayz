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
        // Sabse pehle check karo ki is phone par account bana hai ya nahi
        if (localStorage.getItem('anvi_device_used')) {
            alert("⚠️ Warning: An account has already been created on this device. Multiple accounts are not allowed!");
            return; // Yahin rok do
        }

        if (password.length < 6) {
            alert("Password must be at least 6 characters!");
            return;
        }

        try {
            btn.innerText = "Processing...";
            btn.disabled = true;

            // 1. Create User (Firebase Auth)
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            // Unique Code Generate karo
            const myUniqueCode = "ANVI" + Math.floor(10000 + Math.random() * 90000);
            let referrerId = null;

            // --- REFERRAL LOGIC START ---
            if (referCodeInput !== "") {
                const q = query(collection(db, "users"), where("myReferCode", "==", referCodeInput));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const referrerDoc = querySnapshot.docs[0];
                    referrerId = referrerDoc.id;
                    const referrerData = referrerDoc.data(); // Referrer ka data nikalo

                    // --- 🛑 SECURITY 2: DAILY LIMIT CHECK ---
                    const todayStr = new Date().toISOString().split('T')[0]; // "2026-01-21"
                    let currentDailyCount = referrerData.todayReferCount || 0;
                    let lastDate = referrerData.lastReferDate || "";

                    // Agar date purani hai, to count 0 maano
                    if (lastDate !== todayStr) {
                        currentDailyCount = 0;
                    }

                    // Limit Check (Example: 10 per day)
                    if (currentDailyCount < 10) {
                        
                        // A. Referrer ko Paisa do (Limit ke andar hai)
                        await updateDoc(doc(db, "users", referrerId), {
                            balance: increment(100),
                            totalReferrals: increment(1),
                            referIncome: increment(100), // ✅ Added as requested
                            todayReferCount: currentDailyCount + 1, // Count badhao
                            lastReferDate: todayStr // Aaj ki date set karo
                        });

                        // B. Referrer ki Refer List update
                        await addDoc(collection(db, "users", referrerId, "my_referrals"), {
                            name: name,
                            date: new Date().toISOString(),
                            earnings: 100
                        });

                        // C. Wallet History
                        await addDoc(collection(db, "users", referrerId, "transactions"), {
                            title: "Referral Bonus",
                            description: "Bonus received for referring " + name,
                            amount: 100,
                            type: "credit",
                            date: new Date().toISOString()
                        });

                        // D. Notification
                        await addDoc(collection(db, "users", referrerId, "notifications"), {
                            title: "New Referral!",
                            message: `Congrats! You earned 100 coins for referring a friend.`,
                            type: "success",
                            read: false,
                            date: new Date().toISOString()
                        });

                    } else {
                        console.log("Referrer daily limit reached. No bonus given.");
                        // Optional: Aap chaho to naye user ko bata sakte ho ki refer code expire ho gya aaj ke liye
                    }
                }
            }
            // --- REFERRAL LOGIC END ---

            // 2. Save New User to Database
            await setDoc(doc(db, "users", user.uid), {
                fullName: name,
                email: email,
                balance: 100, // Joining Bonus
                myReferCode: myUniqueCode,
                referredBy: referrerId,
                totalReferrals: 0,
                referIncome: 0,
                // Security fields naye user ke liye bhi set karo
                todayReferCount: 0,
                lastReferDate: new Date().toISOString().split('T')[0],
                createdAt: new Date().toISOString()
            });

            // 3. New User History (Welcome Bonus)
            await addDoc(collection(db, "users", user.uid, "transactions"), {
                title: "Joining Bonus",
                description: "Welcome reward",
                amount: 100,
                type: "credit",
                date: new Date().toISOString()
            });

            // 4. Notification
            await addDoc(collection(db, "users", user.uid, "notifications"), {
                title: "Welcome to AnviPayz",
                message: "You received 100 Coins as a joining bonus. Start earning now!",
                type: "info",
                read: false,
                date: new Date().toISOString()
            });

            // --- 🛑 SECURITY 3: MARK DEVICE ---
            // Safalta purvak account ban gaya, ab stamp laga do
            localStorage.setItem('anvi_device_used', 'true');

            alert("Account Created! Logging in...");
            window.location.href = "home.html";

        } catch (error) {
            console.error(error);
            btn.innerText = "Create Account";
            btn.disabled = false;
            alert("Error: " + error.message);
        }
    });
}