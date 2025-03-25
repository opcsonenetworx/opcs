import { auth } from "./firebase-config.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

const API_URL = "https://script.google.com/macros/s/AKfycbwR4vpOWsx7VMDjzj6qh1SbbKliN2zPz0T71vEgIfpMDDoQ7XO0LscVFnnT4wCy4cro/exec";

const policyForm = document.getElementById("policyForm");
const encoderNameElement = document.getElementById("encoderName");
let currentUserEmail = "Unknown"; // Default value

// Listen for authentication state changes
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUserEmail = user.email;
    encoderNameElement.textContent = `Logged in as: ${user.email}`; // Display encoder's name
  } else {
    window.location.href = "index.html"; // Redirect if not logged in
  }
});

// Handle Form Submission
policyForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(policyForm);
  let policyData = {};

  // Collect form data into an object
  formData.forEach((value, key) => {
    policyData[key] = value.trim();
  });

  // Add metadata
  policyData.action = "addPolicy";
  policyData.employeeHandler = currentUserEmail;

  // Validate required fields
  if (
    !policyData.issueDate || 
    !policyData.assuredName || 
    !policyData.policyNumber || 
    !policyData.totalNetPremium
  ) {
    alert("⚠️ Please fill in all required fields.");
    return;
  }

  try {
    const isLocalhost = window.location.hostname === "127.0.0.1" || 
                        window.location.hostname === "localhost";

    const fetchUrl = API_URL;
    const fetchOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policyData),
    };

    if (isLocalhost) {
      // Use JSONP approach for POST in development
      const tempForm = document.createElement("form");
      tempForm.style.display = "none";
      tempForm.method = "POST";
      tempForm.action = API_URL;

      for (const key in policyData) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = policyData[key];
        tempForm.appendChild(input);
      }

      document.body.appendChild(tempForm);
      tempForm.submit();

      setTimeout(() => {
        document.body.removeChild(tempForm);
      }, 1000);

      alert("✅ Policy submitted! Refresh page to see updates.");
      policyForm.reset();
      return;
    }

    const response = await fetch(fetchUrl, fetchOptions);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Failed to add policy.");
    }

    alert("✅ Policy added successfully!");
    policyForm.reset();
  } catch (error) {
    console.error("Error submitting policy:", error);
    alert(`❌ Failed to submit policy: ${error.message}`);
  }
});

// Logout Functionality
document.getElementById("logoutButton")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "index.html";
  } catch (error) {
    console.error("Logout error:", error);
    alert("Failed to log out.");
  }
});
