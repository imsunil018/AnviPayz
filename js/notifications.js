import { auth, db, onAuthStateChanged, collection, query, orderBy, getDocs } from "./firebase-config.js";

onAuthStateChanged(auth, async (user) => {
    if (user) {
        loadNotifications(user.uid);
    } else {
        window.location.href = "index.html";
    }
});

async function loadNotifications(uid) {
    const listContainer = document.getElementById('notification-list');
    
    try {
        // Notifications ko Date ke hisaab se laao (Newest First)
        const q = query(collection(db, "users", uid, "notifications"), orderBy("date", "desc"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 4rem 1rem; color: var(--text-muted); opacity: 0.7;">
                    <i class="ri-notification-off-line" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                    <p style="font-size: 1rem; font-weight: 500;">No new notifications</p>
                    <p style="font-size: 0.85rem;">We will notify you when you earn bonus.</p>
                </div>`;
            return;
        }

        let html = "";
        
        querySnapshot.forEach((doc) => {
            const item = doc.data();
            const dateObj = new Date(item.date);
            const dateStr = dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            // Icon & Color Logic
            let icon = "ri-information-fill";
            let color = "var(--primary)";
            let bg = "rgba(79, 70, 229, 0.1)";

            if (item.title.toLowerCase().includes("bonus") || item.type === "success") {
                icon = "ri-gift-2-fill";
                color = "#10b981"; // Green
                bg = "rgba(16, 185, 129, 0.1)";
            } else if (item.title.toLowerCase().includes("refer")) {
                icon = "ri-group-fill";
                color = "#f59e0b"; // Orange
                bg = "rgba(245, 158, 11, 0.1)";
            }

            html += `
            <div class="card" style="padding: 1.2rem; display: flex; gap: 1rem; align-items: start; margin-bottom: 0; border-left: 4px solid ${color};">
                <div style="background: ${bg}; color: ${color}; width: 45px; height: 45px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 1.4rem;">
                    <i class="${icon}"></i>
                </div>
                <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <h4 style="font-size: 1rem; font-weight: 600; margin: 0; color: var(--text-main);">${item.title}</h4>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">${dateStr}</span>
                    </div>
                    <p style="font-size: 0.9rem; color: var(--text-muted); margin: 0; line-height: 1.5;">
                        ${item.message}
                    </p>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 8px; text-align: right;">
                        ${timeStr}
                    </div>
                </div>
            </div>`;
        });

        listContainer.innerHTML = html;

    } catch (error) {
        console.error("Noti Error:", error);
        listContainer.innerHTML = `<p style="text-align:center; color:red;">Failed to load data.</p>`;
    }
}