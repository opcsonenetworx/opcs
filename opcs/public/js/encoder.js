import { auth } from "./firebase-config.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

// API Base URL (Replace with your actual Google Apps Script deployment URL)
const GOOGLE_SHEETS_API_URL = "https://script.google.com/macros/s/AKfycbwR4vpOWsx7VMDjzj6qh1SbbKliN2zPz0T71vEgIfpMDDoQ7XO0LscVFnnT4wCy4cro/exec";

// UI Elements
const encoderNameElement = document.getElementById("encoderName");
const logoutButton = document.getElementById("logoutButton");
const policyTableBody = document.getElementById("policyTableBody");
const policyForm = document.getElementById("policyForm");
const summaryModal = document.getElementById("summaryModal");
const summaryDetails = document.getElementById("summaryDetails");
const closeModalBtn = document.getElementById("closeModalBtn");
const closeModalX = document.querySelector(".close-btn");

// Ensure User is Authenticated
onAuthStateChanged(auth, async (user) => {
  if (user) {
    encoderNameElement.textContent = user.email; // Replace with full name from Firestore if needed
    await loadPolicies();
  } else {
    window.location.href = "index.html"; // Redirect if not logged in
  }
});

// Logout Function
logoutButton?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "index.html";
  } catch (error) {
    console.error("Logout error:", error);
    alert("Logout failed. Please try again.");
  }
});

// Fetch Policies from Google Sheets
async function loadPolicies() {
  try {
    console.log("Fetching policies...");
    const response = await fetch(`${GOOGLE_SHEETS_API_URL}?action=getPolicies`);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Failed to fetch policies.");
    }

    const policies = result.data;
    if (!Array.isArray(policies) || policies.length === 0) {
      console.warn("No policy data found.");
      policyTableBody.innerHTML = "<tr><td colspan='6'>No policies available.</td></tr>";
      return;
    }

    policyTableBody.innerHTML = ""; // Clear table before adding new data

    policies.forEach((policy) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${policy.issueDate || ""}</td>
        <td>${policy.assuredName || ""}</td>
        <td>${policy.policyNumber || ""}</td>
        <td>${policy.provider || ""}</td>
        <td>${policy.totalNetPremium || ""}</td>
        <td>${policy.dueDate || ""}</td>
      `;
      policyTableBody.appendChild(row);
    });

    console.log("Policies loaded successfully.");
  } catch (error) {
    console.error("Error fetching policies:", error);
    alert("Failed to load policies. Please try again.");
  }
}

// Handle Form Submission
policyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(policyForm);
  let policyData = {};
  let summaryHTML = "<ul>";

  // Convert formData to an object
  formData.forEach((value, key) => {
    policyData[key] = value.trim();
    summaryHTML += `<li><strong>${key}:</strong> ${value}</li>`;
  });

  summaryHTML += "</ul>";
  summaryDetails.innerHTML = summaryHTML;
  summaryModal.classList.add("show");

  // Validate required fields
  if (!policyData.issueDate || !policyData.assuredName || !policyData.policyNumber) {
    alert("Issue Date, Assured Name, and Policy Number are required!");
    return;
  }

  // Prepare API request
  const apiData = {
    action: "addPolicy",
    issueDate: policyData.issueDate,
    lineOfBusiness: policyData.lineOfBusiness,
    mortgage: policyData.mortgage,
    assuredName: policyData.assuredName,
    policyNumber: policyData.policyNumber,
    provider: policyData.provider,
    endorsementNo: policyData.endorsementNumber,
    inceptionDate: policyData.inceptionDate,
    expiryDate: policyData.expiryDate,
    plateNo: policyData.plateNumber,
    propertyUnitInsured: policyData.propertyInsured,
    pf: policyData.pf,
    odTheftFlSumInsured: policyData.odTheftFlSumInsured,
    aon: policyData.aon,
    bi: policyData.bi,
    pd: policyData.pd,
    pa: policyData.pa,
    others: policyData.others,
    premOdTFl: policyData.premOdFl,
    premAon: policyData.premAon,
    premBi: policyData.premBi,
    premPd: policyData.premPd,
    premPa: policyData.premPa,
    premOther1: policyData.premOther1,
    totalNetPremium: policyData.totalNetPremium,
    docStamp: policyData.docStamp,
    vat: policyData.vat,
    ltg: policyData.lgt,
    fst: policyData.fst,
    others1: policyData.others1,
    grossPremiumTotalAmountDue: policyData.grossPremium,
    taxesPayment: policyData.taxesPayment,
    employeeHandler: policyData.employeeHandler,
    nameOfAgentSubAgent: policyData.agentName,
    clientContactNo: policyData.clientContact,
    clientEmailAddress: policyData.clientEmail,
    dueDate: policyData.dueDate,
  };

  try {
    console.log("Submitting policy data to API...", apiData);
    const response = await fetch(GOOGLE_SHEETS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apiData),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || "Failed to submit policy.");
    }

    alert("Policy added successfully!");
    closeModal();
    policyForm.reset();
    await loadPolicies();
  } catch (error) {
    console.error("Error adding policy:", error);
    alert("Submission failed. Please check your internet connection.");
  }
});

// Close Modal Function
function closeModal() {
  summaryModal.classList.remove("show");
}

// Modal Close Button Handlers
closeModalBtn?.addEventListener("click", closeModal);
closeModalX?.addEventListener("click", closeModal);

// Close Modal if User Clicks Outside
window.addEventListener("click", (event) => {
  if (event.target === summaryModal) {
    closeModal();
  }
});
