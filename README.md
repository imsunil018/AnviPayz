# 💰 AnviPayz - Earning & Rewards Platform

AnviPayz is a lightweight fintech web application where users can earn virtual coins by completing daily tasks, referring friends, and spinning the wheel. Users can redeem these coins for real money (UPI, Paytm) or Gift Cards.

## 🚀 Live Demo
*https://anvipayz.vercel.app/*

---

## ✨ Features

### 🔐 Authentication & Security
- **Email/Password Login & Signup** via Firebase Auth.
- **Device Lock:** Prevents creating multiple accounts on the same device to stop fraud.
- **Secure Database:** User data stored securely in Cloud Firestore.

### 📋 Task System (Gamified)
- **Daily Check-in:** Users earn coins for logging in daily (Resets at 12:00 AM IST).
- **Watch & Earn:** Users watch short video ads (Max 3 per day).
- **Spin the Wheel:** A "Spin & Win" game with random rewards and daily limits.
- **Countdown Timer:** Shows exact time left until tasks reset.

### 🤝 Advanced Referral System
- **Unique Referral Codes:** Auto-generated for every user.
- **Daily Referral Limit:** Users can refer max 10 people/day (Anti-spam).
- **Referral Tracking:** Referrers can see who joined and how much they earned.

### 💳 Wallet & Redemption
- **Real-time Balance:** Instant coin updates.
- **Withdrawal System:** Users can request payouts via Paytm, UPI, or Google Play Codes.
- **Transaction History:** Detailed logs of every earning and spending with status badges (Pending/Success).

### 🎨 UI/UX
- **Modern Dashboard:** Clean, mobile-first design.
- **Dark/Light Mode:** Theme persistence using LocalStorage.
- **Responsive:** Works perfectly on Mobile, Tablet, and Desktop.

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript (ES6+ Modules)
- **Backend:** Firebase (Authentication, Firestore Database)
- **Icons:** Remix Icons
- **Fonts:** Google Fonts (Inter)
- **Hosting:** Vercel (Recommended)

---

## ⚙️ Setup & Installation

1. **Clone the Repository**
   ```bash
   git clone [https://github.com/yourusername/anvipayz.git](https://github.com/yourusername/anvipayz.git)
   cd anvipayz
