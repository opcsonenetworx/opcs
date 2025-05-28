// encoder.js
import { 
  firebaseConfig, 
  auth, 
  db, 
  checkFirestoreAvailability, 
  fetchWithOnlineFirst 
} from './firebase-config.js';
import { 
  initializeAuth, 
  logout, 
  getCurrentUser, 
  getUserData, 
  monitorFirestoreConnectivity 
} from './authentication.js';
import { 
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// Global vars
const spinner = document.getElementById("spinner");
const submitBtn = document.getElementById("submitBtn");
const form = document.getElementById("policyForm");
const SHEETDB_API = "https://sheetdb.io/api/v1/74fageuz0xvvu";

let currentData = null;
let isOnline = navigator.onLine;
let offlineQueue = [];
let connectionCheckInterval;
const RETRY_DELAY = 5000; // 5 seconds
const MAX_RETRIES = 3;

/**
 * Add a better connection status indicator to the UI
 */
function addConnectionStatusIndicator() {
  // Create indicator element if it doesn't exist
  let indicator = document.getElementById('connection-status');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'connection-status';
    indicator.style.position = 'fixed';
    indicator.style.top = '10px';
    indicator.style.right = '10px';
    indicator.style.padding = '5px 10px';
    indicator.style.borderRadius = '4px';
    indicator.style.fontSize = '12px';
    indicator.style.fontWeight = 'bold';
    indicator.style.zIndex = '9999';
    indicator.style.transition = 'background-color 0.3s ease';
    document.body.appendChild(indicator);
  }
  
  // Function to update indicator state
  const updateIndicator = (state) => {
    switch(state) {
      case 'online':
        indicator.textContent = '🟢 Online';
        indicator.style.backgroundColor = '#4CAF50';
        indicator.style.color = 'white';
        break;
      case 'reconnecting':
        indicator.textContent = '🟠 Reconnecting...';
        indicator.style.backgroundColor = '#FF9800';
        indicator.style.color = 'white';
        break;
      case 'offline':
        indicator.textContent = '🔴 Offline';
        indicator.style.backgroundColor = '#F44336';
        indicator.style.color = 'white';
        break;
    }
  };
  
  // Update based on browser online status
  window.addEventListener('online', () => {
    updateIndicator('reconnecting');
    
    // Try to reconnect to Firestore
    setTimeout(() => {
      diagnoseConnectivity().then(success => {
        if (success) {
          updateIndicator('online');
        } else {
          updateIndicator('offline');
        }
      });
    }, 1000);
  });
  
  window.addEventListener('offline', () => {
    updateIndicator('offline');
  });
  
  // Initial state
  updateIndicator(navigator.onLine ? 'online' : 'offline');
  
  // Listen for app-level connectivity events
  document.addEventListener('firestore:connected', () => {
    updateIndicator('online');
  });
  
  document.addEventListener('firestore:disconnected', () => {
    updateIndicator('offline');
  });
  
  return indicator;
}

// Start periodic connectivity checks
function startConnectionCheck() {
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
  }
  
  // Check Firebase connectivity immediately
  checkFirebaseConnectivity();
  
  // Then check periodically
  connectionCheckInterval = setInterval(checkFirebaseConnectivity, 60000); // Check every minute
}

// Stop connectivity checks
function stopConnectionCheck() {
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
    connectionCheckInterval = null;
  }
}

// Check if Firebase is actually reachable
async function checkFirebaseConnectivity() {
  if (!isOnline) return;
  
  const isFirebaseAvailable = await checkFirestoreAvailability();
  
  // If Firebase is not available but navigator says we're online,
  // we have partial connectivity - update the status to reflect this
  if (!isFirebaseAvailable && isOnline) {
    const statusBar = document.getElementById('connection-status');
    if (statusBar) {
      statusBar.style.backgroundColor = '#fff3cd';
      statusBar.style.color = '#856404';
      statusBar.style.height = 'auto';
      statusBar.style.opacity = '1';
      statusBar.style.padding = '4px 15px';
      statusBar.textContent = '⚠️ Limited connectivity - Some features may be unavailable';
    }
  }
}

function updateConnectionStatus() {
  const statusBar = document.getElementById('connection-status');
  if (!statusBar) return;
  
  if (navigator.onLine) {
    statusBar.style.backgroundColor = '#d4edda';
    statusBar.style.color = '#155724';
    statusBar.textContent = '✅ Online - All features available';
    
    // Animate it to disappear after 5 seconds
    setTimeout(() => {
      statusBar.style.opacity = '0';
      setTimeout(() => {
        statusBar.style.height = '0';
        statusBar.style.padding = '0';
      }, 300);
    }, 5000);
  } else {
    statusBar.style.backgroundColor = '#f8d7da';
    statusBar.style.color = '#721c24';
    statusBar.style.height = 'auto';
    statusBar.style.opacity = '1';
    statusBar.style.padding = '4px 15px';
    statusBar.textContent = '⚠️ Offline - Limited functionality available';
  }
}

// Initialize offline queue from localStorage if it exists
function initOfflineQueue() {
  const savedQueue = localStorage.getItem('offlineSubmissionQueue');
  if (savedQueue) {
    try {
      offlineQueue = JSON.parse(savedQueue);
      updateOfflineIndicator();
    } catch (e) {
      console.error("Error parsing offline queue:", e);
      localStorage.removeItem('offlineSubmissionQueue');
      offlineQueue = [];
    }
  }
}

// Update visual indicator for offline submissions
function updateOfflineIndicator() {
  let indicator = document.getElementById('offline-indicator');
  if (offlineQueue.length > 0) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'offline-indicator';
      indicator.style.position = 'fixed';
      indicator.style.bottom = '10px';
      indicator.style.right = '10px';
      indicator.style.backgroundColor = '#ff9800';
      indicator.style.color = 'white';
      indicator.style.padding = '8px 15px';
      indicator.style.borderRadius = '5px';
      indicator.style.fontSize = '14px';
      indicator.style.zIndex = '1000';
      indicator.style.cursor = 'pointer';
      indicator.onclick = function() {
        if (isOnline) {
          processPendingSubmissions();
        } else {
          alert("You're offline. Submissions will be processed automatically when you're back online.");
        }
      };
      document.body.appendChild(indicator);
    }
    
    indicator.textContent = `${offlineQueue.length} pending submission${offlineQueue.length > 1 ? 's' : ''}`;
    indicator.style.display = 'block';
  } else if (indicator) {
    indicator.style.display = 'none';
  }
}

// Process pending submissions when back online
async function processPendingSubmissions() {
  if (!isOnline || offlineQueue.length === 0) return;
  
  // Check Firebase connectivity first
  const isFirebaseAvailable = await checkFirestoreAvailability();
  if (!isFirebaseAvailable) {
    console.log("Firebase is not available, deferring pending submissions");
    return;
  }
  
  spinner.style.display = 'block';
  
  let successCount = 0;
  let failCount = 0;
  const processedItems = [];
  
  for (let i = 0; i < offlineQueue.length; i++) {
    let retries = 0;
    let success = false;
    
    while (retries < MAX_RETRIES && !success) {
      try {
        // First try SheetDB API
        const response = await fetch(SHEETDB_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: [offlineQueue[i]] })
        });
        
        if (response.ok) {
          success = true;
          
          // Then save to Firestore for redundancy
          try {
            await addDoc(collection(db, "policies"), {
              ...offlineQueue[i],
              submitted_at: serverTimestamp(),
              submitted_offline: true,
              sync_completed_at: serverTimestamp()
            });
            
            console.log(`Policy ${offlineQueue[i].POLICY_NUMBER} synchronized successfully`);
          } catch (e) {
            console.warn("Couldn't save to Firestore, but SheetDB succeeded");
          }
        } else {
          throw new Error(`SheetDB API returned status ${response.status}`);
        }
      } catch (error) {
        console.warn(`Retry ${retries + 1}/${MAX_RETRIES} failed:`, error);
        retries++;
        
        if (retries < MAX_RETRIES) {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
      }
    }
    
    if (success) {
      successCount++;
      processedItems.push(i);
    } else {
      failCount++;
    }
  }
  
  if (successCount > 0) {
    // Remove successfully processed items in reverse order to avoid index shifting issues
    for (let i = processedItems.length - 1; i >= 0; i--) {
      offlineQueue.splice(processedItems[i], 1);
    }
    
    localStorage.setItem('offlineSubmissionQueue', JSON.stringify(offlineQueue));
    updateOfflineIndicator();
    
    if (failCount === 0) {
      alert(`✅ Successfully processed all ${successCount} pending submissions!`);
    } else {
      alert(`✅ Processed ${successCount} submissions, but ${failCount} failed and will be retried later.`);
    }
  } else if (failCount > 0) {
    alert("❌ Failed to process pending submissions. Will retry when connection improves.");
  }
  
  spinner.style.display = 'none';
}

// Close modal function
function closeModal() {
  document.getElementById("summaryModal").classList.remove("show");
  currentData = null;
}
window.closeModal = closeModal;

// Update navbar user info function
function updateNavbarUserInfo() {
  const nameEl = document.getElementById("userName");
  const roleEl = document.getElementById("userRole");
  
  if (nameEl && roleEl) {
    const displayName = localStorage.getItem("userDisplayName");
    const role = localStorage.getItem("userRole");
    
    if (displayName) {
      nameEl.textContent = displayName;
    }
    
    if (role) {
      roleEl.textContent = role;
    }
  }
}

// Prefill employee handler field if available
function prefillEmployeeHandler() {
  const employeeHandlerField = document.getElementById("employeeHandler");
  if (employeeHandlerField) {
    const displayName = localStorage.getItem("userDisplayName");
    if (displayName) {
      employeeHandlerField.value = displayName;
    }
  }
}

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
  console.log("DOM loaded, initializing application...");
  try {
    // Add connection status indicator
    addConnectionStatusIndicator();
    
    // Initialize offline queue
    initOfflineQueue();
    
    // Update navbar immediately with data from localStorage (if exists)
    updateNavbarUserInfo();
    
    // Initialize auth
    await initializeAuth();
    
    // Update navbar again after auth init (in case it changed)
    updateNavbarUserInfo();
    
    // Prefill employee handler field
    prefillEmployeeHandler();
    
    // Monitor Firestore connectivity
    monitorFirestoreConnectivity();
    
    // Start connection checks if online
    if (isOnline) {
      startConnectionCheck();
    }
    
    // Add event listener for profile menu toggling
    const profileButton = document.querySelector('.profile');
    if (profileButton) {
      profileButton.addEventListener('click', function() {
        const menu = document.getElementById("profileMenu");
        menu.style.display = menu.style.display === "block" ? "none" : "block";
      });
    }
    
    // Set up event listener for profile menu clicks outside
    document.addEventListener('click', function(event) {
      const profileArea = document.querySelector('.profile');
      const menu = document.getElementById('profileMenu');
      
      if (profileArea && menu && menu.style.display === 'block') {
        if (!profileArea.contains(event.target)) {
          menu.style.display = 'none';
        }
      }
    });
    
    // Add event listener for logout button
    const logoutButton = document.getElementById('logoutBtn');
    if (logoutButton) {
      logoutButton.addEventListener('click', function() {
        logout()
          .then(() => {
            console.log("Logout successful");
            window.location.href = "/opcs/public/index.html";
          })
          .catch(error => {
            console.error("Error during logout:", error);
            alert("Failed to log out. Please try again.");
          });
      });
    }
    
    // Add event listener for profile edit button
    const profileEditButton = document.getElementById('profileEditBtn');
    if (profileEditButton) {
      profileEditButton.addEventListener('click', function() {
        alert("Profile edit functionality will be implemented soon.");
      });
    }
    
    console.log("Authentication and UI initialized successfully");
    
    // If we're back online, try to process any pending submissions
    if (isOnline && offlineQueue.length > 0) {
      processPendingSubmissions();
    }
  } catch (error) {
    console.error("Initialization error:", error);
    // Still allow using the app offline with cached auth
    alert("Warning: Some features may be limited while offline.");
  }
});

// Validate required fields
function validateForm(data) {
  const required = [
    "issueDate", "assuredName", "policyNumber", "expiryDate", "totalNetPremium"
  ];
  for (let key of required) {
    if (!data.get(key)?.trim()) {
      alert(`⚠️ ${key} is required.`);
      return false;
    }
  }
  return true;
}

// Build data for SheetDB
function buildPayload(formData) {
  const userInfo = getCurrentUser() || { displayName: "Unknown", role: "User" };

  return {
    "ISSUE DATE": formData.get("issueDate"),
    "LINE OF BUSINESS": formData.get("lineOfBusiness") || "", // Fixed property name
    "MORTGAGEE": formData.get("mortgagee") || "",
    "ASSURED NAME": formData.get("assuredName"),
    "POLICY NUMBER": formData.get("policyNumber"),
    "PROVIDER": formData.get("provider") || "",
    "ENDORSEMENT NUMBER": formData.get("endorsementNumber") || "",
    "INCEPTION DATE": formData.get("inceptionDate"),
    "EXPIRY DATE": formData.get("expiryDate"),
    "PLATE NUMBER": formData.get("plateNumber") || "",
    "PROPERTY/UNIT INSURED": formData.get("propertyUnitInsured") || "",
    "PF": formData.get("pf") || "",
    "OD/THEFT/FL/SUM INSURED": formData.get("odTheftFlSumInsured") || "",
    "AON": formData.get("aon") || "",
    "BI": formData.get("bi") || "",
    "PD": formData.get("pd") || "",
    "PA": formData.get("pa") || "",
    "OTHERS": formData.get("others") || "",
    "PREM-OD/T/FL": formData.get("premOdTFl") || "",
    "PREM-AON": formData.get("premAon") || "",
    "PREM-BI": formData.get("premBi") || "",
    "PREM-PD": formData.get("premPd") || "",
    "PREM-PA": formData.get("premPa") || "",
    "PREM-OTHER1": formData.get("premOther1") || "",
    "TOTAL NET PREMIUM": formData.get("totalNetPremium"),
    "DOC. STAMP": formData.get("docStamp") || "",
    "VAT": formData.get("vat") || "",
    "LGT": formData.get("lgt") || "",
    "FST": formData.get("fst") || "",
    "OTHERS 1": formData.get("others1") || "",
    "GROSS PREMIUM/TOTAL AMOUNT DUE": formData.get("grossPremiumTotalAmountDue"),
    "TAXES PAYMENT": formData.get("taxesPayment") || "",
    "EMPLOYEE HANDLER": userInfo.displayName || "Unknown",
    "NAME OF AGENT/SUB-AGENT": formData.get("nameOfAgent") || "",
    "CLIENT CONTACT NUMBER": formData.get("clientContactNumber") || "",
    "CLIENT EMAIL ADDRESS": formData.get("clientEmailAddress") || "",
    "DUE DATE": formData.get("dueDate"),
    "SUBMITTED BY ROLE": userInfo.role || "User",
    "SUBMITTED AT": new Date().toISOString(),
    "SUBMITTED OFFLINE": !isOnline
  };
}

// Generate a unique ID for offline submissions
function generateSubmissionId() {
  return `submission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Show summary modal
function showSummary(data) {
  currentData = data;
  const modal = document.getElementById("summaryModal");
  const summaryList = document.getElementById("summaryList");
  summaryList.innerHTML = "";

  for (const [key, val] of Object.entries(data)) {
    if (val && key !== "SUBMITTED AT" && key !== "SUBMITTED OFFLINE") {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="field-name">${key}:</span>
        <span class="field-value">${val}</span>
      `;
      summaryList.appendChild(li);
    }
  }

  // Add connection status notice
  const noticeContainer = document.createElement("div");
  noticeContainer.style.marginTop = "15px";
  noticeContainer.style.borderRadius = "5px";
  noticeContainer.style.textAlign = "center";
  noticeContainer.style.padding = "10px";
  
  // Check real connectivity to Firebase
  checkFirestoreAvailability().then(isAvailable => {
    if (!navigator.onLine) {
      // Fully offline
      noticeContainer.style.backgroundColor = "#f8d7da";
      noticeContainer.style.color = "#721c24";
      noticeContainer.innerHTML = "⚠️ You're currently offline. This submission will be queued and processed when you're back online.";
    } else if (!isAvailable) {
      // Online but no Firebase connection
      noticeContainer.style.backgroundColor = "#fff3cd";
      noticeContainer.style.color = "#856404";
      noticeContainer.innerHTML = "⚠️ Limited connectivity detected. This submission will be sent to SheetDB and queued for Firebase sync.";
    } else {
      // Fully online
      noticeContainer.style.backgroundColor = "#d4edda";
      noticeContainer.style.color = "#155724";
      noticeContainer.innerHTML = "✅ You're online. This submission will be processed immediately.";
    }
    
    summaryList.parentNode.insertBefore(noticeContainer, summaryList.nextSibling);
  });

  modal.classList.add("show");
}

// Handle form submit to show summary modal
if (submitBtn) {
  submitBtn.addEventListener('click', (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    if (!validateForm(formData)) return;

    const payload = buildPayload(formData);
    showSummary(payload);
  });
}

// Submit data to SheetDB with retry logic
async function submitToSheetDB(data, maxRetries = 2) {
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      const response = await fetch(SHEETDB_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [data] })
      });
      
      if (!response.ok) {
        throw new Error(`SheetDB returned status ${response.status}`);
      }
      
      return true; // Success
    } catch (error) {
      console.warn(`SheetDB submit attempt ${retries + 1} failed:`, error);
      retries++;
      
      if (retries <= maxRetries) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      } else {
        throw error; // All retries failed
      }
    }
  }
}

// Submit data to Firestore with retry logic
async function submitToFirestore(data, maxRetries = 2) {
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      // Generate ID for easier tracking
      const submissionId = generateSubmissionId();
      
      // Try to save with specific ID for easier retrieval 
      await setDoc(doc(db, "policies", submissionId), {
        ...data,
        id: submissionId,
        submitted_at: serverTimestamp()
      });
      
      return true; // Success
    } catch (error) {
      console.warn(`Firestore submit attempt ${retries + 1} failed:`, error);
      retries++;
      
      if (retries <= maxRetries) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      } else {
        throw error; // All retries failed
      }
    }
  }
}

// Confirm submission from modal
const confirmBtn = document.getElementById("confirmSubmit");
if (confirmBtn) {
  confirmBtn.addEventListener("click", async () => {
    if (!currentData) return;
    
    spinner.style.display = "block";
    
    try {
      // First check if Firestore is available
      let firestoreAvailable = false;
      let sheetDbSuccess = false;
      let firestoreSuccess = false;
      const submissionId = generateSubmissionId();
      currentData.id = submissionId;
      
      if (navigator.onLine) {
        firestoreAvailable = await checkFirestoreAvailability();
        
        // First try SheetDB regardless of Firestore availability
        try {
          await submitToSheetDB(currentData);
          sheetDbSuccess = true;
        } catch (error) {
          console.warn("SheetDB submission failed:", error);
        }
        
        // Then try Firestore if available
        if (firestoreAvailable) {
          try {
            await submitToFirestore(currentData);
            firestoreSuccess = true;
          } catch (error) {
            console.warn("Firestore submission failed:", error);
          }
        }
        
        // If at least one succeeded, consider it a success
        if (sheetDbSuccess || firestoreSuccess) {
          // If SheetDB succeeded but Firestore failed, queue for Firebase sync later
          if (sheetDbSuccess && !firestoreSuccess) {
            const firestoreQueue = JSON.parse(localStorage.getItem('firestoreSyncQueue') || '[]');
            firestoreQueue.push(currentData);
            localStorage.setItem('firestoreSyncQueue', JSON.stringify(firestoreQueue));
            alert("✅ Submission sent to SheetDB successfully! Firebase sync will happen when connection improves.");
          } else {
            alert("✅ Submission successful!");
          }
          
          form.reset();
          closeModal();
        } else {
          // Both online methods failed, add to offline queue
          throw new Error("All online submission methods failed");
        }
      } else {
        // Offline - add to queue
        throw new Error("Device is offline");
      }
    } catch (error) {
      console.error("Submission error:", error);
      
      // Add to offline queue
      offlineQueue.push(currentData);
      localStorage.setItem('offlineSubmissionQueue', JSON.stringify(offlineQueue));
      updateOfflineIndicator();
      
      // Also try to store in local Firestore cache if possible
      try {
        await addDoc(collection(db, "policies"), {
          ...currentData,
          submitted_at: new Date(),
          pending_sync: true
        });
        console.log("Added to Firestore local cache for future sync");
      } catch (e) {
        console.warn("Could not add to Firestore local cache:", e);
      }
      
      alert("✅ Submission queued for when you're back online!");
      form.reset();
      closeModal();
    } finally {
      spinner.style.display = "none";
    }
  });
}

// Export for debugging and testing
export {
  initOfflineQueue,
  processPendingSubmissions,
  closeModal,
  validateForm,
  buildPayload,
  showSummary,
  checkFirebaseConnectivity,
  submitToSheetDB,
  submitToFirestore
};