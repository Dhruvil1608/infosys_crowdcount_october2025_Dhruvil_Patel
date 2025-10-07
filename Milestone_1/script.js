// Helper: base API URL for backend (adjust if your backend runs elsewhere)
const API_BASE = "http://localhost:5000";

// Helper to show alerts (replace with UI feedback as needed)
function showAlert(msg) {
  alert(msg);
}

// Login handler — sends credentials to backend and redirects on success
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!/^[^ ]+@[^ ]+\.[a-z]{2,}$/.test(email) || password.length < 6) {
      showAlert("Please enter a valid email and password (min 6 chars).");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // store minimal user info and move to dashboard
        localStorage.setItem('user', JSON.stringify(data.user));
        window.location.href = "dashboard.html";
      } else {
        showAlert(data.message || 'Login failed');
      }
    } catch (err) {
      console.error('Login error', err);
      showAlert('Unable to reach server. Make sure the backend is running.');
    }
  });
}

// Registration handler — sends new user data to backend /register endpoint
const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (username === "" || !/^[^ ]+@[^ ]+\.[a-z]{2,}$/.test(email) || password.length < 6) {
      showAlert("Please fill all fields correctly.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showAlert('Registration successful — please login.');
        window.location.href = 'index.html';
      } else {
        showAlert(data.message || 'Registration failed');
      }
    } catch (err) {
      console.error('Registration error', err);
      showAlert('Unable to reach server. Make sure the backend is running.');
    }
  });
}

// Dashboard logout — remove stored user and go to login
function logout() {
  localStorage.removeItem('user');
  window.location.href = 'index.html';
}
