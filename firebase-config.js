import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAM5mV__clDgnlDN63lDNZaH_inXrjkEsM",
  authDomain: "smart-task-tracker-57163.firebaseapp.com",
  projectId: "smart-task-tracker-57163",
  storageBucket: "smart-task-tracker-57163.firebasestorage.app",
  messagingSenderId: "248300395860",
  appId: "1:248300395860:web:2e8b605f101d63fe57fcc1"
};

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
