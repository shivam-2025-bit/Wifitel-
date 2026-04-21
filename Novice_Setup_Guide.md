# 🚀 Wifitel: Novice-Friendly Setup & APK Guide

Welcome! This guide will help you take **Wifitel** from this preview to your own GitHub and finally onto your phone as a real Android App (APK).

---

## 1️⃣ Step 1: Moving to GitHub
1.  Look at the top right of this screen and click the **Settings (⚙️)** icon.
2.  Select **"Export to GitHub"**.
3.  Sign into your GitHub account and give your project a name (e.g., `wifitel-app`). 
4.  GitHub will create a "Repository" which stores all your code safely.

---

## 2️⃣ Step 2: Setting up Firebase (Your App's Brain)
Wifitel needs Firebase to send messages and video calls.
1.  Go to the [Firebase Console](https://console.firebase.google.com/).
2.  Click **"Add Project"** and name it `Wifitel`.
3.  Once the project is ready, click the **Web icon (`</>`)** to add an app.
4.  You will see a block of code called `firebaseConfig`. It looks like this:
    ```javascript
    const firebaseConfig = {
      apiKey: "YOUR_API_KEY",
      authDomain: "your-app.firebaseapp.com",
      projectId: "your-app",
      ...
    };
    ```
5.  In your code (either here or on GitHub), open the file: **`src/lib/firebase.ts`**.
6.  Replace the placeholder values with your real ones from the Firebase Console.

---

## 3️⃣ Step 3: Generating the APK (Android App)
Since Wifitel is built as a modern Web App, we use a tool called **Capacitor** to turn it into an Android APK. This is much easier for beginners than writing complex Java code!

### Run these commands in your GitHub Codespace or local terminal:

1.  **Build your web code:**
    ```bash
    npm run build
    ```

2.  **Add Android support:**
    ```bash
    npm install @capacitor/core @capacitor/cli @capacitor/android
    npx cap init Wifitel com.wifitel.app --web-dir dist
    npx cap add android
    ```

3.  **Open in Android Studio:**
    ```bash
    npx cap open android
    ```
    *Note: This will open a program called Android Studio. If you don't have it, download it [here](https://developer.android.com/studio).*

4.  **Create the APK:**
    - Inside Android Studio, wait for it to finish loading (look at the bar at the bottom).
    - Go to the top menu: **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
    - Once finished, a small popup will appear in the corner. Click **"locate"** to find your `app-debug.apk` file!

---

## 💡 Pro Tip: The "Zero-Install" Way
If you don't want to deal with APKs, you can use the **Web App** directly on your phone:
1.  Open your GitHub website URL on your phone's browser (Chrome or Safari).
2.  Tap the **"Share"** button (iPhone) or **"Three Dots"** (Android).
3.  Select **"Add to Home Screen"**.
4.  Wifitel will now appear as an icon on your phone and open just like a real app!
