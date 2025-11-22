// admin-script.js - Admin Panel Functionality
// This file handles all admin panel operations

// Global variables for admin (don't redeclare API_BASE as it's in main script)
let tempThresholds = {};

// Check if user is admin and show/hide dashboard menu
async function checkAdminAccess() {
  const storedUser = localStorage.getItem('user');
  if (storedUser) {
    const userData = JSON.parse(storedUser);
    if (userData.role === 'admin') {
      const dashboardMenu = document.getElementById('dashboardMenuItem');
      if (dashboardMenu) {
        dashboardMenu.style.display = 'block';
      }
      return true;
    }
  }
  return false;
}

// Load admin dashboard data
async function loadAdminDashboard() {
  console.log('🔄 Loading admin dashboard...');
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/stats`);
    const data = await res.json();
    
    if (data.success) {
      // Update stats cards
      const statsElements = {
        'adminTotalUsers': data.stats.total_users,
        'adminTotalDetections': data.stats.total_detections,
        'adminTodayDetections': data.stats.today_detections,
        'adminActiveZones': data.stats.active_zones
      };
      
      for (const [id, value] of Object.entries(statsElements)) {
        const element = document.getElementById(id);
        if (element) {
          element.textContent = value;
        }
      }
      
      console.log('✅ Admin stats loaded');
    }
    
    // Load all admin sections
    await refreshUserList();
    await refreshZoneList();
    await refreshActivityLogs();
    await loadGlobalThresholds();
    
    console.log('✅ Admin dashboard fully loaded');
    
  } catch (err) {
    console.error('❌ Error loading admin dashboard:', err);
    alert('Failed to load admin dashboard. Please check console for details.');
  }
}

// ==================== USER MANAGEMENT ====================

async function refreshUserList() {
  console.log('🔄 Refreshing user list...');
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/users`);
    const data = await res.json();
    
    const tbody = document.getElementById('userManagementTable');
    
    if (!tbody) {
      console.error('❌ User management table not found');
      return;
    }
    
    if (data.success && data.users.length > 0) {
      tbody.innerHTML = data.users.map(user => `
        <tr>
          <td>${user.username}</td>
          <td>${user.email}</td>
          <td>
            <select onchange="updateUserRole(${user.id}, this.value)" style="padding:5px; border-radius:5px; background:#232a3b; color:#fff; border:1px solid #8e2de2;">
              <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </td>
          <td>${new Date(user.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-danger" onclick="deleteUser(${user.id}, '${user.username}')" style="padding:5px 10px; font-size:0.8em;">
              <i class="fas fa-trash"></i> Delete
            </button>
          </td>
        </tr>
      `).join('');
      
      console.log(`✅ Loaded ${data.users.length} users`);
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 40px; color: #ccc;">
            No users found
          </td>
        </tr>
      `;
    }
  } catch (err) {
    console.error('❌ Error loading users:', err);
    alert('Failed to load users. Error: ' + err.message);
  }
}

async function updateUserRole(userId, newRole) {
  console.log(`🔄 Updating user ${userId} role to ${newRole}...`);
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole })
    });
    
    const data = await res.json();
    
    if (data.success) {
      alert('User role updated successfully!');
      await refreshUserList();
      console.log('✅ User role updated');
    } else {
      alert('Failed to update role: ' + data.message);
    }
  } catch (err) {
    console.error('❌ Error updating role:', err);
    alert('Error updating user role: ' + err.message);
  }
}

async function deleteUser(userId, username) {
  if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
    return;
  }
  
  console.log(`🔄 Deleting user ${userId}...`);
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/users/${userId}`, {
      method: 'DELETE'
    });
    
    const data = await res.json();
    
    if (data.success) {
      alert('User deleted successfully!');
      await refreshUserList();
      await loadAdminDashboard();
      console.log('✅ User deleted');
    } else {
      alert('Failed to delete user: ' + data.message);
    }
  } catch (err) {
    console.error('❌ Error deleting user:', err);
    alert('Error deleting user: ' + err.message);
  }
}

function showAddUserModal() {
  const modal = document.getElementById('addUserModal');
  if (modal) {
    modal.style.display = 'flex';
  } else {
    console.error('❌ Add user modal not found');
  }
}

function closeAddUserModal() {
  const modal = document.getElementById('addUserModal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  // Clear form
  const fields = ['newUsername', 'newUserEmail', 'newUserPassword'];
  fields.forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = '';
  });
  
  const roleSelect = document.getElementById('newUserRole');
  if (roleSelect) roleSelect.value = 'user';
}

async function addNewUser() {
  const username = document.getElementById('newUsername')?.value.trim();
  const email = document.getElementById('newUserEmail')?.value.trim();
  const password = document.getElementById('newUserPassword')?.value;
  const role = document.getElementById('newUserRole')?.value || 'user';
  
  if (!username || !email || !password) {
    alert('Please fill all fields');
    return;
  }
  
  if (password.length < 6) {
    alert('Password must be at least 6 characters');
    return;
  }
  
  console.log('🔄 Adding new user...');
  
  try {
    const res = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, role })
    });
    
    const data = await res.json();
    
    if (data.success) {
      alert('User added successfully!');
      closeAddUserModal();
      await refreshUserList();
      await loadAdminDashboard();
      console.log('✅ User added');
    } else {
      alert('Failed to add user: ' + data.message);
    }
  } catch (err) {
    console.error('❌ Error adding user:', err);
    alert('Error adding user: ' + err.message);
  }
}

// ==================== ZONE MANAGEMENT ====================

async function refreshZoneList() {
  console.log('🔄 Refreshing zone list...');
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/zones`);
    const data = await res.json();
    
    const container = document.getElementById('zoneManagementList');
    
    if (!container) {
      console.error('❌ Zone management list not found');
      return;
    }
    
    if (data.success && Object.keys(data.zones).length > 0) {
      container.innerHTML = '<h3 style="color: #8e2de2; margin-bottom: 10px;">Active Zones:</h3>';
      
      for (const [zoneName, zonePoints] of Object.entries(data.zones)) {
        const threshold = data.thresholds[zoneName] || 'Not Set';
        
        const zoneDiv = document.createElement('div');
        zoneDiv.className = 'zone-item';
        zoneDiv.innerHTML = `
          <div>
            <span class="zone-name">${zoneName}</span>
            <span style="color: #ccc; margin-left: 10px;">(${zonePoints.length} points)</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="color: #fff;">Threshold: ${threshold}</span>
            <button class="btn" onclick="editZoneThreshold('${zoneName}', ${threshold})" style="padding: 5px 10px; font-size: 0.8em;">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn btn-danger" onclick="deleteZoneAdmin('${zoneName}')" style="padding: 5px 10px; font-size: 0.8em;">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        `;
        container.appendChild(zoneDiv);
      }
      
      console.log(`✅ Loaded ${Object.keys(data.zones).length} zones`);
    } else {
      container.innerHTML = '<p style="color: #ccc;">No zones configured yet. Create zones in the analysis sections.</p>';
    }
  } catch (err) {
    console.error('❌ Error loading zones:', err);
    alert('Failed to load zones: ' + err.message);
  }
}

async function deleteZoneAdmin(zoneName) {
  if (!confirm(`Are you sure you want to delete zone "${zoneName}"?`)) {
    return;
  }
  
  console.log(`🔄 Deleting zone ${zoneName}...`);
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/zones/${zoneName}`, {
      method: 'DELETE'
    });
    
    const data = await res.json();
    
    if (data.success) {
      alert('Zone deleted successfully!');
      await refreshZoneList();
      await loadAdminDashboard();
      console.log('✅ Zone deleted');
    } else {
      alert('Failed to delete zone: ' + data.message);
    }
  } catch (err) {
    console.error('❌ Error deleting zone:', err);
    alert('Error deleting zone: ' + err.message);
  }
}

function editZoneThreshold(zoneName, currentThreshold) {
  const newThreshold = prompt(`Set threshold for ${zoneName}:`, currentThreshold === 'Not Set' ? '10' : currentThreshold);
  
  if (newThreshold && !isNaN(newThreshold)) {
    setZoneThresholdAdmin(zoneName, parseInt(newThreshold));
  }
}

async function setZoneThresholdAdmin(zoneName, threshold) {
  console.log(`🔄 Setting threshold for ${zoneName}...`);
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/set_zone_threshold`, {
      method: 'POST',
      body: JSON.stringify({
        zone_name: zoneName,
        threshold: threshold
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      alert(`Threshold set for ${zoneName}: ${threshold} people`);
      await refreshZoneList();
      console.log('✅ Threshold set');
    } else {
      alert('Failed to set threshold: ' + data.message);
    }
  } catch (err) {
    console.error('❌ Error setting threshold:', err);
    alert('Error setting threshold: ' + err.message);
  }
}

function showBulkThresholdModal() {
  console.log('🔄 Loading bulk threshold modal...');
  
  // Get zones from the global zoneThresholds variable
  const zones = Object.keys(window.zoneThresholds || {});
  
  if (zones.length === 0) {
    alert('No zones available. Create zones first in the analysis sections.');
    return;
  }
  
  let html = '<div style="max-height: 400px; overflow-y: auto;">';
  
  zones.forEach(zone => {
    const current = window.zoneThresholds[zone] || 10;
    html += `
      <div style="margin-bottom: 15px;">
        <label style="color: #8e2de2; display: block; margin-bottom: 5px;">${zone}:</label>
        <input type="number" id="threshold_${zone.replace(/\s+/g, '_')}" value="${current}" min="1" 
               style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #8e2de2; background: #232a3b; color: #fff;">
      </div>
    `;
  });
  
  html += '</div>';
  
  const modal = document.createElement('div');
  modal.style.cssText = 'display:flex; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:10000; align-items:center; justify-content:center;';
  modal.innerHTML = `
    <div style="background:#181a20; border-radius:12px; padding:30px; max-width:500px; width:90%; max-height:80vh; overflow-y:auto;">
      <h2 style="color:#8e2de2; margin-bottom:20px;">Set Zone Thresholds</h2>
      ${html}
      <div style="display:flex; gap:10px; margin-top:20px;">
        <button class="btn btn-success" onclick="saveBulkThresholds()" style="flex:1;">
          <i class="fas fa-check"></i> Save All
        </button>
        <button class="btn btn-danger" onclick="this.closest('div').parentElement.parentElement.remove()" style="flex:1;">
          <i class="fas fa-times"></i> Cancel
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

async function saveBulkThresholds() {
  console.log('🔄 Saving bulk thresholds...');
  
  const zones = Object.keys(window.zoneThresholds || {});
  let updated = 0;
  
  for (const zone of zones) {
    const inputId = `threshold_${zone.replace(/\s+/g, '_')}`;
    const input = document.getElementById(inputId);
    if (input) {
      const value = parseInt(input.value);
      if (!isNaN(value) && value > 0) {
        try {
          await setZoneThresholdAdmin(zone, value);
          updated++;
        } catch (err) {
          console.error(`Failed to update ${zone}:`, err);
        }
      }
    }
  }
  
  alert(`${updated} thresholds updated!`);
  await refreshZoneList();
  
  // Close modal
  const modals = document.querySelectorAll('[style*="position:fixed"]');
  modals.forEach(m => m.remove());
  
  console.log('✅ Bulk thresholds saved');
}

// ==================== ACTIVITY LOGS ====================

async function refreshActivityLogs() {
  console.log('🔄 Refreshing activity logs...');
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/activity`);
    const data = await res.json();
    
    const tbody = document.getElementById('activityLogsTable');
    
    if (!tbody) {
      console.error('❌ Activity logs table not found');
      return;
    }
    
    if (data.success && data.activities.length > 0) {
      tbody.innerHTML = data.activities.map(activity => `
        <tr>
          <td>${activity.username || 'Unknown'}</td>
          <td><span style="color: #8e2de2; font-weight: bold;">${activity.activity_type}</span></td>
          <td>${activity.activity_details || '-'}</td>
          <td>${new Date(activity.timestamp).toLocaleString()}</td>
        </tr>
      `).join('');
      
      console.log(`✅ Loaded ${data.activities.length} activity logs`);
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 40px; color: #ccc;">
            No activity logs found
          </td>
        </tr>
      `;
    }
  } catch (err) {
    console.error('❌ Error loading activity logs:', err);
    alert('Failed to load activity logs: ' + err.message);
  }
}

// ==================== DATA EXPORT ====================

async function exportDataCSV() {
  const startDate = document.getElementById('exportStartDate')?.value;
  const endDate = document.getElementById('exportEndDate')?.value;
  
  if (!startDate || !endDate) {
    alert('Please select both start and end dates');
    return;
  }
  
  console.log(`🔄 Exporting CSV from ${startDate} to ${endDate}...`);
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/export/csv`, {
      method: 'POST',
      body: JSON.stringify({ start_date: startDate, end_date: endDate })
    });
    
    const data = await res.json();
    
    if (data.success) {
      // Download CSV file
      const csvContent = atob(data.csv_data);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      a.click();
      window.URL.revokeObjectURL(url);
      
      alert('CSV exported successfully!');
      console.log('✅ CSV exported');
    } else {
      alert('Failed to export CSV: ' + data.message);
    }
  } catch (err) {
    console.error('❌ Error exporting CSV:', err);
    alert('Error exporting CSV: ' + err.message);
  }
}

async function exportDataPDF() {
  const startDate = document.getElementById('exportStartDate')?.value;
  const endDate = document.getElementById('exportEndDate')?.value;
  
  if (!startDate || !endDate) {
    alert('Please select both start and end dates');
    return;
  }
  
  console.log(`🔄 Exporting PDF from ${startDate} to ${endDate}...`);
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/export/pdf`, {
      method: 'POST',
      body: JSON.stringify({ start_date: startDate, end_date: endDate })
    });
    
    const data = await res.json();
    
    if (data.success) {
      // Download PDF file
      const pdfContent = atob(data.pdf_data);
      const bytes = new Uint8Array(pdfContent.length);
      for (let i = 0; i < pdfContent.length; i++) {
        bytes[i] = pdfContent.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      a.click();
      window.URL.revokeObjectURL(url);
      
      alert('PDF exported successfully!');
      console.log('✅ PDF exported');
    } else {
      alert('Failed to export PDF: ' + data.message);
    }
  } catch (err) {
    console.error('❌ Error exporting PDF:', err);
    alert('Error exporting PDF: ' + err.message);
  }
}

// ==================== GLOBAL SETTINGS ====================

async function loadGlobalThresholds() {
  console.log('🔄 Loading global thresholds...');
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/settings/thresholds`);
    const data = await res.json();
    
    const container = document.getElementById('globalThresholdSettings');
    
    if (!container) {
      console.error('❌ Global threshold settings container not found');
      return;
    }
    
    if (data.success && Object.keys(data.thresholds).length > 0) {
      container.innerHTML = '';
      
      for (const [zone, threshold] of Object.entries(data.thresholds)) {
        const item = document.createElement('div');
        item.className = 'setting-item';
        item.innerHTML = `
          <span class="setting-label">${zone}</span>
          <input type="number" value="${threshold}" min="1" 
                 onchange="tempThresholds['${zone}'] = parseInt(this.value)"
                 style="padding: 8px; border-radius: 5px; background: #232a3b; color: #fff; border: 1px solid #8e2de2; width: 100px;">
        `;
        container.appendChild(item);
      }
      
      console.log(`✅ Loaded ${Object.keys(data.thresholds).length} global thresholds`);
    } else {
      container.innerHTML = '<p style="color: #ccc;">No threshold settings available yet.</p>';
    }
  } catch (err) {
    console.error('❌ Error loading thresholds:', err);
    alert('Failed to load threshold settings: ' + err.message);
  }
}

async function saveGlobalSettings() {
  if (Object.keys(tempThresholds).length === 0) {
    alert('No changes to save');
    return;
  }
  
  console.log('🔄 Saving global settings...');
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/admin/settings/thresholds`, {
      method: 'PUT',
      body: JSON.stringify({ thresholds: tempThresholds })
    });
    
    const data = await res.json();
    
    if (data.success) {
      alert('Settings saved successfully!');
      tempThresholds = {};
      await loadGlobalThresholds();
      console.log('✅ Global settings saved');
    } else {
      alert('Failed to save settings: ' + data.message);
    }
  } catch (err) {
    console.error('❌ Error saving settings:', err);
    alert('Error saving settings: ' + err.message);
  }
}

// ==================== INITIALIZATION ====================

// Set default date range (last 30 days) when DOM is loaded
window.addEventListener('DOMContentLoaded', function() {
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const formatDate = (date) => {
    return date.toISOString().split('T')[0];
  };
  
  const startInput = document.getElementById('exportStartDate');
  const endInput = document.getElementById('exportEndDate');
  
  if (startInput) startInput.value = formatDate(thirtyDaysAgo);
  if (endInput) endInput.value = formatDate(today);
  
  // Check admin access and show dashboard menu
  checkAdminAccess();
  
  console.log('✅ Admin script initialized');
});

// Export functions to global scope
window.loadAdminDashboard = loadAdminDashboard;
window.refreshUserList = refreshUserList;
window.updateUserRole = updateUserRole;
window.deleteUser = deleteUser;
window.showAddUserModal = showAddUserModal;
window.closeAddUserModal = closeAddUserModal;
window.addNewUser = addNewUser;
window.refreshZoneList = refreshZoneList;
window.deleteZoneAdmin = deleteZoneAdmin;
window.editZoneThreshold = editZoneThreshold;
window.showBulkThresholdModal = showBulkThresholdModal;
window.saveBulkThresholds = saveBulkThresholds;
window.refreshActivityLogs = refreshActivityLogs;
window.exportDataCSV = exportDataCSV;
window.exportDataPDF = exportDataPDF;
window.loadGlobalThresholds = loadGlobalThresholds;
window.saveGlobalSettings = saveGlobalSettings;

console.log('✅ Admin functions exported to global scope');