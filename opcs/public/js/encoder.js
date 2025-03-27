import { auth } from "./firebase-config.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

const API_URL = "https://script.google.com/macros/s/AKfycbwR4vpOWsx7VMDjzj6qh1SbbKliN2zPz0T71vEgIfpMDDoQ7XO0LscVFnnT4wCy4cro/exec";
const policyForm = document.getElementById("policyForm");
const encoderNameElement = document.getElementById("encoderName");
let currentUserEmail = "Unknown"; // Default value

// Monitor Firebase Auth State
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUserEmail = user.email;
    encoderNameElement.textContent = `Logged in as: ${user.email}`; // Show encoder name
  } else {
    window.location.href = "index.html"; // Redirect if not logged in
  }
});

// Validate Required Fields Dynamically
function validatePolicyData(policyData) {
  const requiredFields = [
    "issueDate",
    "assuredName",
    "policyNumber",
    "totalNetPremium",
  ];

  for (const field of requiredFields) {
    if (!policyData[field] || policyData[field].trim() === "") {
      alert(`⚠️ ${field.replace(/([A-Z])/g, ' $1')} is required!`);
      return false;
    }
  }
  return true;
}

// Build Policy Payload
function buildPolicyPayload(formData) {
  let policyData = {};

  // Collect form data into an object
  formData.forEach((value, key) => {
    policyData[key] = value.trim();
  });

  // Add metadata
  policyData.action = "addPolicy";
  policyData.employeeHandler = currentUserEmail;
  policyData.dateEncoded = new Date().toISOString();

  return policyData;
}

// Submit Policy Data
async function submitPolicy(policyData) {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policyData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("🔴 Server Error:", errorText);
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      alert("✅ Policy submitted successfully!");
      policyForm.reset(); // Clear form
    } else {
      throw new Error(result.message || "Failed to submit policy.");
    }
  } catch (error) {
    console.error("⚠️ Error Submitting Policy:", error);
    alert(`❌ Failed to submit policy: ${error.message}`);
  }
}

// Handle Form Submission
policyForm.addEventListener("submit", (event) => {
  event.preventDefault(); // Prevent full page reload

  const formData = new FormData(policyForm);
  const policyData = buildPolicyPayload(formData);

  // Validate before submission
  if (validatePolicyData(policyData)) {
    submitPolicy(policyData);
  }
});

// Logout Functionality
document.getElementById("logoutButton")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    alert("✅ Logged out successfully!");
    window.location.href = "index.html"; // Redirect to login
  } catch (error) {
    console.error("Logout error:", error);
    alert("❌ Failed to log out. Please try again.");
  }
});
