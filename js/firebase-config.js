// firebase-config.js - Modified to fix collection() errors

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { 
  getFirestore, 
  enableNetwork as enableFirestoreNetwork, 
  disableNetwork as disableFirestoreNetwork,
  getDoc, 
  doc,
  collection as firestoreCollection
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// Your web app's Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyDzmmD6twcKj1_O6_9OFGlva7nrsahASDk",
  authDomain: "onenetworx-policy-n-collection.firebaseapp.com",
  projectId: "onenetworx-policy-n-collection",
  storageBucket: "onenetworx-policy-n-collection.firebasestorage.app",
  messagingSenderId: "857746150023",
  appId: "1:857746150023:web:99790ce722455b78e9de22",
  measurementId: "G-GKCEJPKMV0"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Create and export Firestore instance
let db;
try {
  db = getFirestore(app);
  console.log("Firestore initialized successfully");
} catch (error) {
  console.error("Error initializing Firestore:", error);
  // Provide a fallback or placeholder
  db = null;
}

// IMPORTANT: Export db directly without any renaming or modification
export { db };

// Export Firestore functions - Fix: Don't re-export collection as it creates issues
// Use the original imported function instead
export { doc, getDoc, firestoreCollection as collection };

// Create and export Auth instance
export const auth = getAuth(app);

/**
 * Check if Firestore is available and accessible
 * @returns {Promise<boolean>} True if Firestore is available
 */
export async function checkFirestoreAvailability() {
  if (!db || !navigator.onLine) return false;
  
  try {
    // Try to access a small document or collection to check connectivity
    const testDoc = doc(db, "_connectivity_test", "status");
    await getDoc(testDoc);
    return true;
  } catch (error) {
    console.warn("Firestore connectivity check failed:", error);
    return false;
  }
}

/**
 * Fetch data with online-first strategy
 * @param {string} url URL to fetch
 * @param {Object} options Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function fetchWithOnlineFirst(url, options = {}) {
  if (navigator.onLine) {
    try {
      return await fetch(url, options);
    } catch (error) {
      console.warn("Online fetch failed, trying cache:", error);
      // Fall through to cache
    }
  }
  
  // Try from cache if online fetch failed or we're offline
  try {
    const cache = await caches.open('policy-data-cache');
    const cachedResponse = await cache.match(url);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    throw new Error('No cached data available');
  } catch (error) {
    console.error("Cache fetch failed:", error);
    throw new Error('Unable to fetch data: both network and cache unavailable');
  }
}

export { enableFirestoreNetwork as enableNetwork, disableFirestoreNetwork as disableNetwork };