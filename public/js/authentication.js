// authentication.js - User Authentication Module

import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { 
  doc, 
  getDoc,
  setDoc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js";

// Import Firebase config with initialized services
import { auth, db, enableNetwork, disableNetwork } from './firebase-config.js';

// Global variables for auth state
let currentUser = null;
let userProfile = null;
let unsubscribeUserListener = null;
let isAppOnline = navigator.onLine;

// Constants for application
const APP_MODES = {
  ENCODING: "Encoding",
  VIEWING: "Viewer"
};

const APP_PAGES = {
  [APP_MODES.ENCODING]: "EncodingEncoder.html",
  [APP_MODES.VIEWING]: "ViewingEncoder.html",
  LOGIN: "index.html"
};

const ROLES = {
  ADMIN: "Admin",
  SUPER_ADMIN: "SuperAdmin",
  USER: "User",
  EMPLOYEE: "Employee"
};

/**
 * Diagnose and fix connectivity issues
 * @returns {Promise<boolean>} Success status
 */
export async function diagnoseConnectivity() {
  // Check browser online status
  const browserOnline = navigator.onLine;
  console.log(`Browser reports online status: ${browserOnline}`);
  
  // Try a simple fetch to Google to verify internet connectivity
  try {
    const response = await fetch('https://www.google.com/generate_204', {
      mode: 'no-cors',
      cache: 'no-store'
    });
    console.log(`Network connectivity test: ${response.type}`);
  } catch (error) {
    console.error(`Network connectivity test failed: ${error.message}`);
  }
  
  // Check if Firestore network is enabled
  try {
    await enableNetwork(db);
    console.log("Firestore network enabled");
    
    // Try to access Firestore with a simple test
    const testDoc = doc(db, "_connectivity_test", "test");
    try {
      await getDoc(testDoc);
      console.log("Firestore test document retrieved successfully");
      return true;
    } catch (docError) {
      console.error(`Firestore test document error: ${docError.message}`);
      
      // If failed due to being offline, try reconnecting
      if (docError.message.includes("offline")) {
        console.log("Attempting to reconnect to Firestore...");
        
        // Force reconnect by toggling network
        await disableNetwork(db);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await enableNetwork(db);
        
        console.log("Firestore network re-enabled");
      }
    }
  } catch (error) {
    console.error(`Error enabling Firestore network: ${error.message}`);
  }
  
  return false;
}

/**
 * Setup online/offline detection
 */
function setupConnectivityListeners() {
  // Listen for online status changes
  window.addEventListener('online', () => {
    console.log('App is now online');
    isAppOnline = true;
    document.dispatchEvent(new CustomEvent('app:online'));
    
    // Resume real-time listeners
    if (currentUser) {
      setupUserDataListener(currentUser.uid);
    }
    
    // Update UI
    updateOfflineIndicator();
  });
  
  window.addEventListener('offline', () => {
    console.log('App is now offline');
    isAppOnline = false;
    document.dispatchEvent(new CustomEvent('app:offline'));
    
    // Clean up listeners to prevent errors
    if (unsubscribeUserListener) {
      unsubscribeUserListener();
      unsubscribeUserListener = null;
    }
    
    // Update UI
    updateOfflineIndicator();
  });
}

/**
 * Initialize authentication without auto-redirects
 * @param {boolean} allowRedirect Whether to allow redirects (defaults to false)
 * @returns {Promise<Object|null>} User profile or null if not authenticated
 */
export async function initializeAuth(allowRedirect = false) {
  console.log("Initializing authentication with allowRedirect:", allowRedirect);
  
  // Setup connectivity listeners
  setupConnectivityListeners();
  
  // Return a promise that resolves when auth state is determined
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        console.log("User is signed in:", user.uid);
        currentUser = user;
        
        try {
          // Fetch user profile data
          const userData = await fetchUserData(user.uid);
          userProfile = userData;
          
          // Update UI with user data
          updateUserDisplay(userData);
          
          // Set up real-time listener for profile updates if online
          if (isAppOnline) {
            setupUserDataListener(user.uid);
          }
          
          // Prefill employee handler if needed
          prefillEmployeeHandler();
          
          // Only handle redirects if explicitly allowed
          if (allowRedirect) {
            handleAuthRedirects();
          }
          
          resolve(userData);
        } catch (error) {
          console.error("Error retrieving user data:", error);
          
          // Create minimal profile from auth data as fallback
          const fallbackProfile = createFallbackProfile(user);
          userProfile = fallbackProfile;
          
          updateUserDisplay(fallbackProfile);
          resolve(fallbackProfile);
        }
      } else {
        // User is signed out
        console.log("No user signed in");
        currentUser = null;
        userProfile = null;
        
        // Clear any listeners
        if (unsubscribeUserListener) {
          unsubscribeUserListener();
          unsubscribeUserListener = null;
        }
        
        // Only redirect to login if explicitly allowed and not already on login page
        if (allowRedirect && !isOnLoginPage()) {
          console.log("Redirect allowed and not on login page, redirecting...");
          window.location.href = "/opcs/public/index.html";
        } else {
          console.log("No redirect needed or not allowed");
        }
        
        resolve(null);
      }
    }, (error) => {
      // Handle auth state change errors
      console.error("Auth state change error:", error);
      resolve(null);
    });
  });
}

/**
 * Check if current page is the login page
 * @returns {boolean} True if on login page
 */
function isOnLoginPage() {
  const currentPath = window.location.pathname;
  return (
    currentPath.endsWith("index.html") || 
    currentPath === "/" || 
    currentPath === "/opcs/public/" ||
    currentPath.endsWith("login.html")
  );
}

/**
 * Handle redirects based on authentication state and app mode
 * Only called when explicitly requested
 */
function handleAuthRedirects() {
  // Only handle redirects if on login page
  if (!isOnLoginPage()) {
    return;
  }
  
  // Check if user has selected a mode previously
  const lastUsedMode = sessionStorage.getItem('lastUsedMode');
  
  if (lastUsedMode && APP_PAGES[lastUsedMode]) {
    console.log(`Found last used mode: ${lastUsedMode}`);
    const redirectPage = APP_PAGES[lastUsedMode];
    console.log(`Redirecting to: ${redirectPage}`);
    window.location.href = redirectPage;
  }
}

// Updated fetchUserData function to fix collection() error

async function fetchUserData(uid) {
  // Make sure db is defined and valid
  if (!db) {
    console.error("Firestore database instance is not defined");
    throw new Error("Firestore database instance is not defined");
  }
  
  try {
    // Try users collection first
    const userDocRef = doc(db, "users", uid);
    const userDoc = await getDoc(userDocRef);
    
    if (userDoc.exists()) {
      return userDoc.data();
    }
    
    // Try employees collection as fallback - FIX: Create collection reference properly
    // The key issue was likely here - collection wasn't being imported from the right place
    // or was being called incorrectly
    const employeesCollection = collection(db, "employees");
    const employeesQuery = query(
      employeesCollection, 
      where("uid", "==", uid)
    );
    
    const employeeSnap = await getDocs(employeesQuery);
    
    if (!employeeSnap.empty) {
      const employeeData = employeeSnap.docs[0].data();
      return {
        displayName: employeeData.name || employeeData.displayName || "Employee",
        email: employeeData.email,
        role: employeeData.role || ROLES.EMPLOYEE,
        department: employeeData.department || "General",
        employeeId: employeeData.employeeId,
        ...employeeData
      };
    }
    
    // No profile found, create a new one
    console.log("No user profile found, creating new one");
    
    const newProfile = {
      displayName: currentUser.displayName || currentUser.email.split('@')[0],
      email: currentUser.email,
      role: ROLES.USER,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp()
    };
    
    // Create document in users collection
    await setDoc(userDocRef, newProfile);
    
    return newProfile;
  } catch (error) {
    console.error("Error in fetchUserData:", error);
    throw error;
  }
}

/**
 * Create a fallback profile from auth data
 * @param {Object} user Firebase user object
 * @returns {Object} Basic user profile
 */
function createFallbackProfile(user) {
  return {
    displayName: user.displayName || user.email.split('@')[0],
    email: user.email,
    role: ROLES.USER
  };
}

/**
 * Login function
 * @param {string} email User email
 * @param {string} password User password
 * @returns {Promise<Object>} Login result with user and profile
 */
export async function login(email, password) {
  // Reject if offline
  if (!isAppOnline) {
    throw new Error("Unable to login while offline. Please check your internet connection.");
  }
  
  try {
    // Attempt sign in
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    try {
      // Fetch user profile data
      const userData = await fetchUserData(user.uid);
      
      // Update last login time
      const userDocRef = doc(db, "users", user.uid);
      await setDoc(userDocRef, {
        lastLogin: serverTimestamp()
      }, { merge: true });
      
      // Update global state
      currentUser = user;
      userProfile = userData;
      
      // Set up listeners
      setupUserDataListener(user.uid);
      
      return {
        user,
        userData
      };
    } catch (error) {
      console.error("Error fetching user data during login:", error);
      
      // Create minimal profile from auth data as fallback
      const fallbackProfile = createFallbackProfile(user);
      
      // Update global state
      currentUser = user;
      userProfile = fallbackProfile;
      
      return {
        user,
        userData: fallbackProfile
      };
    }
  } catch (error) {
    console.error("Login error:", error);
    throw error;
  }
}

/**
 * Set up real-time listener for user data changes
 * @param {string} uid User ID
 */
function setupUserDataListener(uid) {
  if (!isAppOnline) return;
  
  // Clear any existing listener
  if (unsubscribeUserListener) {
    unsubscribeUserListener();
  }
  
  // Set up listener for users collection
  const userRef = doc(db, "users", uid);
  
  try {
    unsubscribeUserListener = onSnapshot(userRef, 
      (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          userProfile = {
            ...userProfile,
            ...data,
            displayName: data.displayName || data.name || userProfile?.displayName
          };
          
          // Update UI with new data
          updateUserDisplay(userProfile);
          
          // Update the employeeHandler field if needed
          prefillEmployeeHandler();
          
          console.log("User profile updated from real-time listener");
          
          // Dispatch event for other components
          document.dispatchEvent(new CustomEvent('userProfileUpdated', { 
            detail: { 
              ...userProfile,
              offlineMode: !isAppOnline
            } 
          }));
        }
      },
      (error) => {
        console.error("Error in user data listener:", error);
      }
    );
  } catch (e) {
    console.error("Error setting up Firestore listener:", e);
  }
}

/**
 * Update the UI with user data
 * @param {Object} userData User profile data
 */
function updateUserDisplay(userData) {
  if (!userData) return;
  
  const nameEl = document.getElementById("userName");
  const roleEl = document.getElementById("userRole");
  const profileImg = document.querySelector(".profile img");
  
  if (nameEl) {
    nameEl.textContent = userData.displayName || "User";
  }
  
  if (roleEl) {
    roleEl.textContent = userData.role || ROLES.USER;
  }
  
  if (profileImg && userData.photoURL) {
    profileImg.src = userData.photoURL;
  }
  
  // Update offline indicator
  updateOfflineIndicator();
  
  // Dispatch custom event for other components
  document.dispatchEvent(new CustomEvent('userProfileUpdated', { 
    detail: { 
      displayName: userData.displayName || "User",
      role: userData.role || ROLES.USER,
      department: userData.department || "General",
      photoURL: userData.photoURL,
      offlineMode: !isAppOnline
    } 
  }));
}

/**
 * Update offline indicator in UI
 */
function updateOfflineIndicator() {
  const offlineIndicator = document.getElementById("offline-indicator");
  if (offlineIndicator) {
    offlineIndicator.style.display = !isAppOnline ? 'block' : 'none';
  }
}

/**
 * Prefill employee handler field
 */
export function prefillEmployeeHandler() {
  const employeeHandlerInput = document.getElementById("employeeHandler");
  if (employeeHandlerInput && userProfile) {
    employeeHandlerInput.value = userProfile.displayName || "Unknown";
  }
}

/**
 * Logout function
 * @param {string} redirectUrl URL to redirect to after logout
 * @returns {Promise<boolean>} Success status
 */
export async function logout(redirectUrl = "/opcs/public/index.html") {
  // Clear any listeners
  if (unsubscribeUserListener) {
    unsubscribeUserListener();
    unsubscribeUserListener = null;
  }
  
  try {
    // Sign out from Firebase
    await signOut(auth);
    currentUser = null;
    userProfile = null;
    
    // Clear auth-related items
    localStorage.removeItem("userDisplayName");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userUid");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userPhotoURL");
    
    // Use the provided redirect URL or default
    if (redirectUrl) {
      window.location.href = redirectUrl;
    }
    
    return true;
  } catch (error) {
    console.error("Error during logout:", error);
    throw error;
  }
}

/**
 * Get current user with profile data
 * @returns {Object|null} Current user data or null
 */
export function getCurrentUser() {
  if (currentUser) {
    return {
      uid: currentUser.uid,
      email: currentUser.email,
      displayName: userProfile?.displayName || currentUser.email?.split('@')[0],
      role: userProfile?.role || ROLES.USER,
      department: userProfile?.department || "General",
      photoURL: userProfile?.photoURL,
      employeeId: userProfile?.employeeId,
      isOffline: !isAppOnline,
      ...userProfile
    };
  }
  
  return null;
}

/**
 * Get user data
 * @param {string} uid User ID (optional, uses current user if not provided)
 * @returns {Promise<Object|null>} User data or null
 */
export async function getUserData(uid) {
  if (!uid && currentUser) {
    uid = currentUser.uid;
  }
  
  if (!uid) {
    throw new Error("No user ID provided and no current user found");
  }
  
  try {
    return await fetchUserData(uid);
  } catch (error) {
    console.error("Error getting user data:", error);
    throw error;
  }
}

/**
 * Check if user has admin privileges
 * @returns {boolean} True if user is admin
 */
export function isUserAdmin() {
  const user = getCurrentUser();
  return user && (
    user.role === ROLES.ADMIN || 
    user.role === ROLES.SUPER_ADMIN || 
    user.isAdmin === true
  );
}

/**
 * Check if user has a specific role
 * @param {string} role Role to check
 * @returns {boolean} True if user has the role
 */
export function hasUserRole(role) {
  const user = getCurrentUser();
  return user && user.role === role;
}

/**
 * Check if user has any of the specified roles
 * @param {string[]} roles Array of roles to check
 * @returns {boolean} True if user has any of the roles
 */
export function hasAnyRole(roles = []) {
  const user = getCurrentUser();
  return user && roles.includes(user.role);
}

/**
 * Check if app is online
 * @returns {boolean} True if online
 */
export function isOnline() {
  return isAppOnline;
}

/**
 * Set the current app mode
 * @param {string} mode Mode to set
 */
export function setAppMode(mode) {
  if (mode in APP_MODES) {
    sessionStorage.setItem('lastUsedMode', mode);
    console.log(`App mode set to: ${mode}`);
  } else {
    console.warn(`Invalid app mode attempted: ${mode}`);
  }
}

/**
 * Get the current app mode
 * @returns {string|null} Current mode or null
 */
export function getAppMode() {
  return sessionStorage.getItem('lastUsedMode');
}

/**
 * Monitor Firestore connectivity and dispatch events
 * @returns {boolean} Success status
 */
export function monitorFirestoreConnectivity() {
  try {
    console.log("Setting up Firestore connectivity monitor...");
    
    // Set up a listener for Firestore connectivity
    let firestoreConnected = false;
    let checkInterval;
    
    // Create a function to check connectivity
    const checkFirestoreConnection = async () => {
      if (!isAppOnline) return;
      
      try {
        // Try a simple Firestore operation
        const testRef = doc(db, "_connectivity_test", "test");
        await getDoc(testRef);
        
        // If we got here, Firestore is accessible
        if (!firestoreConnected) {
          firestoreConnected = true;
          console.log("Firestore connection established");
          document.dispatchEvent(new CustomEvent('firestore:connected'));
          
          // Re-setup user data listener if user is logged in
          if (currentUser && !unsubscribeUserListener) {
            setupUserDataListener(currentUser.uid);
          }
        }
      } catch (error) {
        // If we can't access Firestore
        if (firestoreConnected) {
          firestoreConnected = false;
          console.log("Firestore connection lost");
          document.dispatchEvent(new CustomEvent('firestore:disconnected'));
        }
      }
    };
    
    // Initial check
    checkFirestoreConnection();
    
    // Set up periodic checking when online
    window.addEventListener('online', () => {
      checkFirestoreConnection();
      
      // Start periodic checks
      if (!checkInterval) {
        checkInterval = setInterval(checkFirestoreConnection, 30000); // Check every 30 seconds
      }
    });
    
    // Clear interval when offline
    window.addEventListener('offline', () => {
      if (firestoreConnected) {
        firestoreConnected = false;
        document.dispatchEvent(new CustomEvent('firestore:disconnected'));
      }
      
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    });
    
    // Start interval if online
    if (isAppOnline) {
      checkInterval = setInterval(checkFirestoreConnection, 30000); // Check every 30 seconds
    }
    
    // Clean up on page unload
    window.addEventListener('unload', () => {
      if (checkInterval) {
        clearInterval(checkInterval);
      }
    });
    
    return true;
  } catch (error) {
    console.error("Error setting up connectivity monitor:", error);
    return false;
  }
}

// Export common variables
export {
  currentUser,
  userProfile,
  APP_MODES,
  ROLES
}