import { auth, db } from "./js/firebase-config.js";  // Ensure Firestore (db) is imported
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const userEmailElement = document.getElementById("userEmail");
const logoutButton = document.getElementById("logoutButton");

// Handle authentication state changes
onAuthStateChanged(auth, async (user) => {
  if (user) {
    userEmailElement.textContent = "Logged in as: " + user.email;

    try {
      // Fetch user role from Firestore
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const userData = userSnap.data();
        const userRole = userData.role;

        // Redirect based on role
        switch (userRole) {
          case "encoder":
            window.location.href = "encoder.html";
            break;
          case "underwriter":
            window.location.href = "underwriter.html";
            break;
          case "collection":
            window.location.href = "collection.html";
            break;
          case "sales":
            window.location.href = "sales.html";
            break;
          case "cashier":
            window.location.href = "cashier.html";
            break;
          case "accounting-assistant":
            window.location.href = "accounting-assistant.html";
            break;
          case "accountant":
            window.location.href = "accountant.html";
            break;
          case "president":
            window.location.href = "admin.html";
            break;
          default:
            alert("Unauthorized role detected.");
            await signOut(auth);
            window.location.href = "index.html";
        }
      } else {
        console.error("User data not found.");
        await signOut(auth);
        window.location.href = "index.html";
      }
    } catch (error) {
      console.error("Error fetching user role:", error);
    }
  } else {
    // Redirect to login if no user is logged in
    window.location.href = "index.html";
  }
});

// Logout function
logoutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "index.html"; // Redirect to login after logout
  } catch (error) {
    console.error("Logout error:", error);
  }
});
