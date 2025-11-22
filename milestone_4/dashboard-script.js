const API_BASE = "http://localhost:5000";
let user = null;

// Image Analysis variables
let uploadedImage = null;
let imageZones = {};
let imageCanvas, imageCtx;
let isDrawingImageZone = false;
let currentImageZonePoints = [];
let imageZoneCounter = 1;

// Global variables to track video analysis stats
let videoMaxPeopleCount = 0;
let videoTotalCrossings = 0;
let videoZoneCountsData = {};

// Video Analysis variables
let uploadedVideo = null;
let videoLine = null;
let videoZones = {};
let videoAnalysisInterval = null;
let isDrawingVideoLine = false;
let isDrawingVideoZone = false;
let videoLineStart = null;
let currentVideoZonePoints = [];
let videoStartTime = 0;
let videoCanvas, videoCtx;
let isAnalyzing = false;
let videoZoneCounter = 1;

// Webcam Analysis variables
let webcamLine = null;
let webcamZones = {};
let webcamAnalysisInterval = null;
let isDrawingWebcamLine = false;
let isDrawingWebcamZone = false;
let webcamLineStart = null;
let currentWebcamZonePoints = [];
let webcamStartTime = 0;
let webcamActive = false;
let webcamCanvas, webcamCtx;
let maxWebcamPeopleCount = 0;
let webcamZoneCounter = 1;

// Live Dashboard variables
let liveChart = null;
let zoneChart = null;
let historicalData = [];
let zoneThresholds = {};
let enableHeatmap = false;
let alertSound = null;
let activeAlerts = new Set();

// Home section chart instances
let homeLineChartInstance = null;
let homeDailyChartInstance = null;

// Helper functions for authentication
function getToken() {
  return localStorage.getItem('token');
}

function isAuthenticated() {
  return !!getToken();
}

async function authenticatedFetch(url, options = {}) {
  const token = getToken();
  
  if (!token) {
    window.location.href = 'index.html';
    throw new Error('No authentication token');
  }
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };
  
  try {
    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = 'index.html';
      throw new Error('Unauthorized');
    }
    
    return response;
  } catch (error) {
    console.error('API call error:', error);
    throw error;
  }
}

window.onload = async function() {
  if (!isAuthenticated()) {
    window.location.href = 'index.html';
    return;
  }
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/verify-token`, {
      method: 'POST'
    });
    
    const data = await res.json();
    
    if (!data.success) {
      logout();
      return;
    }
    
    user = data.user;
  } catch (err) {
    console.error('Token verification failed', err);
    logout();
    return;
  }
  
  const storedUser = localStorage.getItem('user');
if (storedUser) {
  const userData = JSON.parse(storedUser);
  document.getElementById('username').textContent = userData.username;
  
  // CRITICAL FIX: Show dashboard menu for admin users
  if (userData.role === 'admin') {
    document.getElementById('dashboardMenuItem').style.display = 'block';
    console.log('✅ Admin user detected - Dashboard menu shown');
  }
}
  
  imageCanvas = document.getElementById('imageCanvas');
  imageCtx = imageCanvas.getContext('2d');
  
  videoCanvas = document.getElementById('videoCanvas');
  videoCtx = videoCanvas.getContext('2d');
  
  webcamCanvas = document.getElementById('webcamCanvas');
  webcamCtx = webcamCanvas.getContext('2d');
  
  // Initialize alert sound
  alertSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGGS56+qeSwkLUKXj8LJoHQU2jdXuyH0pBSd+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkLT6Ld8LBpHQY2jdXuyH0pBSd+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkL');
  
  loadHomeStats();
  loadZoneThresholds();
};

async function loadHomeStats() {
  try {
    const res = await authenticatedFetch(`${API_BASE}/get_analytics`);
    const data = await res.json();
    
    if (data.success && data.analytics.length > 0) {
      const today = new Date().toDateString();
      let todayTotal = 0;
      let todaySessions = 0;
      
      data.analytics.forEach(log => {
        const logDate = new Date(log.timestamp).toDateString();
        if (logDate === today) {
          todayTotal += log.total_count;
          todaySessions++;
        }
      });
      
      document.getElementById('totalCount').textContent = todayTotal;
      document.getElementById('activeSessions').textContent = todaySessions;
      document.getElementById('detectionRate').textContent = data.analytics.length;
      
      // Display recent activity
      const recentDiv = document.getElementById('recentActivity');
      recentDiv.innerHTML = '';
      const recent = data.analytics.slice(0, 3);
      
      if (recent.length === 0) {
        recentDiv.innerHTML = '<p style="color: #ccc;">No recent activity. Start a detection session!</p>';
      } else {
        recent.forEach(log => {
          const actDiv = document.createElement('div');
          actDiv.style.cssText = 'background: rgba(50,50,60,0.4); padding: 10px; border-radius: 6px; margin-bottom: 10px;';
          const time = new Date(log.timestamp).toLocaleString();
          const details = log.zone_counts;
          const type = details.type || 'unknown';
          actDiv.innerHTML = `<strong>${log.total_count} people</strong> detected via <span style="color: #8e2de2;">${type}</span> at ${time}`;
          recentDiv.appendChild(actDiv);
        });
      }
      
      // Draw Chart.js charts
      drawHomeLineChart(data.analytics);
      drawHomeDailyChart(data.analytics);
      
    } else {
      document.getElementById('recentActivity').innerHTML = '<p style="color: #ccc;">No recent activity. Start a detection session!</p>';
      
      // Show empty state for charts
      showEmptyChartState('homeLineChartContainer', 'No detection data available yet. Start analyzing to see trends!');
      showEmptyChartState('homeDailyChartContainer', 'No daily data available yet. Start analyzing to see daily totals!');
    }
  } catch (err) {
    console.error('Error loading stats:', err);
    document.getElementById('recentActivity').innerHTML = '<p style="color: #ff6b6b;">Error loading activity</p>';
  }
}

function showEmptyChartState(containerId, message) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `<p style="color: #ccc; text-align: center; padding: 50px 0;">${message}</p>`;
  }
}

function drawHomeLineChart(analytics) {
  const container = document.getElementById('homeLineChartContainer');
  if (!container) return;
  
  // Clear existing content
  container.innerHTML = '';
  
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'homeLineChart';
  container.appendChild(canvas);
  
  if (analytics.length === 0) {
    showEmptyChartState('homeLineChartContainer', 'No data yet');
    return;
  }
  
  // Group data by type
  const webcamData = [];
  const videoData = [];
  const imageData = [];
  
  // Sort analytics by timestamp
  const sortedAnalytics = [...analytics].sort((a, b) => 
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  sortedAnalytics.forEach((log, index) => {
    const timestamp = new Date(log.timestamp);
    const timeStr = timestamp.toLocaleString('en-US', { 
      month: 'short',
      day: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    let details;
    try {
      details = typeof log.zone_counts === 'string' ? JSON.parse(log.zone_counts) : log.zone_counts;
    } catch (e) {
      details = { type: 'unknown' };
    }
    
    const type = details.type || 'unknown';
    const dataPoint = { 
      x: index, 
      y: log.total_count, 
      label: timeStr,
      timestamp: timestamp 
    };
    
    if (type === 'webcam') {
      webcamData.push(dataPoint);
    } else if (type === 'video') {
      videoData.push(dataPoint);
    } else if (type === 'image') {
      imageData.push(dataPoint);
    }
  });
  
  // Take last 15 data points for each type
  const webcamDisplay = webcamData.slice(-15);
  const videoDisplay = videoData.slice(-15);
  const imageDisplay = imageData.slice(-15);
  
  // Combine all labels
  const allLabels = [...new Set([
    ...webcamDisplay.map(d => d.label),
    ...videoDisplay.map(d => d.label),
    ...imageDisplay.map(d => d.label)
  ])].slice(-15);
  
  // Destroy previous chart instance
  if (homeLineChartInstance) {
    homeLineChartInstance.destroy();
  }
  
  // Create Chart.js line chart
  const ctx = canvas.getContext('2d');
  homeLineChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        {
          label: 'Webcam',
          data: webcamDisplay.map(d => d.y),
          borderColor: '#00ff00',
          backgroundColor: 'rgba(0, 255, 0, 0.1)',
          borderWidth: 3,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#00ff00',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          tension: 0.4,
          fill: true
        },
        {
          label: 'Video',
          data: videoDisplay.map(d => d.y),
          borderColor: '#ff6b6b',
          backgroundColor: 'rgba(255, 107, 107, 0.1)',
          borderWidth: 3,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#ff6b6b',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          tension: 0.4,
          fill: true
        },
        {
          label: 'Image',
          data: imageDisplay.map(d => d.y),
          borderColor: '#f39c12',
          backgroundColor: 'rgba(243, 156, 18, 0.1)',
          borderWidth: 3,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#f39c12',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#fff',
            font: {
              size: 14,
              weight: 'bold'
            },
            padding: 15,
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(30, 30, 40, 0.95)',
          titleColor: '#8e2de2',
          bodyColor: '#fff',
          borderColor: '#8e2de2',
          borderWidth: 2,
          padding: 12,
          displayColors: true,
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ' + context.parsed.y + ' people';
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: 'Detection Sessions',
            color: '#8e2de2',
            font: {
              size: 14,
              weight: 'bold'
            }
          },
          ticks: {
            color: '#ccc',
            maxRotation: 45,
            minRotation: 45,
            font: {
              size: 11
            }
          },
          grid: {
            color: 'rgba(142, 45, 226, 0.1)',
            drawBorder: false
          }
        },
        y: {
          display: true,
          title: {
            display: true,
            text: 'People Count',
            color: '#8e2de2',
            font: {
              size: 14,
              weight: 'bold'
            }
          },
          ticks: {
            color: '#ccc',
            font: {
              size: 12
            },
            stepSize: 1,
            beginAtZero: true
          },
          grid: {
            color: 'rgba(142, 45, 226, 0.1)',
            drawBorder: false
          }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  });
  
  // Set canvas height
  canvas.style.height = '350px';
}

function drawHomeDailyChart(analytics) {
  const container = document.getElementById('homeDailyChartContainer');
  if (!container) return;
  
  // Clear existing content
  container.innerHTML = '';
  
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'homeDailyChart';
  container.appendChild(canvas);
  
  if (analytics.length === 0) {
    showEmptyChartState('homeDailyChartContainer', 'No data yet');
    return;
  }
  
  // Group data by date
  const dailyData = {};
  
  analytics.forEach(log => {
    const date = new Date(log.timestamp);
    const dateStr = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
    
    if (!dailyData[dateStr]) {
      dailyData[dateStr] = {
        total: 0,
        webcam: 0,
        video: 0,
        image: 0
      };
    }
    
    dailyData[dateStr].total += log.total_count;
    
    // Parse zone_counts to get type
    let details;
    try {
      details = typeof log.zone_counts === 'string' ? JSON.parse(log.zone_counts) : log.zone_counts;
    } catch (e) {
      details = { type: 'unknown' };
    }
    
    const type = details.type || 'unknown';
    if (type === 'webcam') {
      dailyData[dateStr].webcam += log.total_count;
    } else if (type === 'video') {
      dailyData[dateStr].video += log.total_count;
    } else if (type === 'image') {
      dailyData[dateStr].image += log.total_count;
    }
  });
  
  // Convert to arrays and get last 7 days
  const sortedDates = Object.keys(dailyData).sort((a, b) => 
    new Date(a) - new Date(b)
  );
  const displayDates = sortedDates.slice(-7);
  
  const webcamCounts = displayDates.map(date => dailyData[date].webcam);
  const videoCounts = displayDates.map(date => dailyData[date].video);
  const imageCounts = displayDates.map(date => dailyData[date].image);
  
  if (displayDates.length === 0) {
    showEmptyChartState('homeDailyChartContainer', 'No daily data yet');
    return;
  }
  
  // Destroy previous chart instance
  if (homeDailyChartInstance) {
    homeDailyChartInstance.destroy();
  }
  
  // Create Chart.js bar chart
  const ctx = canvas.getContext('2d');
  homeDailyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: displayDates,
      datasets: [
        {
          label: 'Webcam',
          data: webcamCounts,
          backgroundColor: 'rgba(0, 255, 0, 0.8)',
          borderColor: '#00ff00',
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false
        },
        {
          label: 'Video',
          data: videoCounts,
          backgroundColor: 'rgba(255, 107, 107, 0.8)',
          borderColor: '#ff6b6b',
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false
        },
        {
          label: 'Image',
          data: imageCounts,
          backgroundColor: 'rgba(243, 156, 18, 0.8)',
          borderColor: '#f39c12',
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#fff',
            font: {
              size: 14,
              weight: 'bold'
            },
            padding: 15,
            usePointStyle: true,
            pointStyle: 'rect'
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(30, 30, 40, 0.95)',
          titleColor: '#8e2de2',
          bodyColor: '#fff',
          borderColor: '#8e2de2',
          borderWidth: 2,
          padding: 12,
          displayColors: true,
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ' + context.parsed.y + ' people';
            },
            footer: function(tooltipItems) {
              let sum = 0;
              tooltipItems.forEach(item => {
                sum += item.parsed.y;
              });
              return 'Total: ' + sum + ' people';
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          display: true,
          title: {
            display: true,
            text: 'Date (Last 7 Days)',
            color: '#8e2de2',
            font: {
              size: 14,
              weight: 'bold'
            }
          },
          ticks: {
            color: '#ccc',
            font: {
              size: 11
            },
            maxRotation: 45,
            minRotation: 45
          },
          grid: {
            display: false
          }
        },
        y: {
          stacked: true,
          display: true,
          title: {
            display: true,
            text: 'Total People Detected',
            color: '#8e2de2',
            font: {
              size: 14,
              weight: 'bold'
            }
          },
          ticks: {
            color: '#ccc',
            font: {
              size: 12
            },
            stepSize: 1,
            beginAtZero: true
          },
          grid: {
            color: 'rgba(142, 45, 226, 0.1)',
            drawBorder: false
          }
        }
      }
    }
  });
  
  // Set canvas height
  canvas.style.height = '350px';
}

function showSection(section) {
  console.log('🔄 Switching to section:', section);
  
  // Hide all sections
  const sections = document.querySelectorAll('.content-section');
  sections.forEach(s => s.style.display = 'none');
  
  // Remove active class from all menu items
  const menuItems = document.querySelectorAll('.sidebar li[data-section]');
  menuItems.forEach(li => li.classList.remove('active'));
  
  // Show the selected section
  const sectionId = section + 'Section';
  const sectionElement = document.getElementById(sectionId);
  
  if (sectionElement) {
    sectionElement.style.display = 'block';
    console.log('✅ Section displayed:', sectionId);
    
    // Add active class to the corresponding menu item
    const activeMenuItem = document.querySelector(`.sidebar li[data-section="${section}"]`);
    if (activeMenuItem) {
      activeMenuItem.classList.add('active');
    }
    
    // Load section-specific data
    if (section === 'analytics') {
      loadAnalytics('all');
    } else if (section === 'home') {
      loadHomeStats();
    } else if (section === 'dashboard') {
      loadAdminDashboard();
    } else if (section === 'settings') {
      loadSettings();
    }
  } else {
    console.error('❌ Section not found:', sectionId);
  }
}

// Also make sure this function exists - add it if missing
function logout() {
  // Try to log logout activity before actually logging out
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.id) {
    fetch(`${API_BASE}/save_detection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        type: 'logout',
        people_count: 0,
        crossed_count: 0,
        zone_counts: {}
      })
    }).catch(e => console.log('Could not log logout'));
  }
  
  // Clear storage and redirect
  localStorage.removeItem('user');
  localStorage.removeItem('token');
  window.location.href = 'index.html';
}

// ==================== LIVE DASHBOARD FEATURES ====================

function updateLiveChart(count, timestamp) {
  historicalData.push({ time: timestamp, count: count });
  
  if (historicalData.length > 50) {
    historicalData.shift();
  }
  
  const chartDiv = document.getElementById('liveChartDisplay');
  if (chartDiv && chartDiv.style.display !== 'none') {
    drawLineChart();
  }
}

function drawLineChart() {
  const container = document.getElementById('liveChartDisplay');
  if (!container) return;
  
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.id = 'liveLineChart';
  container.appendChild(canvas);
  
  if (historicalData.length === 0) {
    container.innerHTML = '<p style="color: #ccc; text-align: center; padding: 50px 0;">No data yet</p>';
    return;
  }
  
  const ctx = canvas.getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: historicalData.map(d => d.time),
      datasets: [{
        label: 'People Count',
        data: historicalData.map(d => d.count),
        borderColor: '#00ff00',
        backgroundColor: 'rgba(0, 255, 0, 0.1)',
        borderWidth: 3,
        pointRadius: 4,
        pointBackgroundColor: '#00ff00',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#fff'
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#ccc' },
          grid: { color: 'rgba(142, 45, 226, 0.1)' }
        },
        y: {
          ticks: { color: '#ccc', beginAtZero: true },
          grid: { color: 'rgba(142, 45, 226, 0.1)' }
        }
      }
    }
  });
  
  canvas.style.height = '200px';
}

function drawZoneBarChart(zoneCounts) {
  const container = document.getElementById('zoneChartDisplay');
  if (!container || !zoneCounts || Object.keys(zoneCounts).length === 0) return;
  
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.id = 'zoneBarChart';
  container.appendChild(canvas);
  
  const zones = Object.keys(zoneCounts);
  const counts = Object.values(zoneCounts);
  
  // Determine colors based on thresholds
  const backgroundColors = zones.map(zone => {
    const count = zoneCounts[zone];
    const threshold = zoneThresholds[zone];
    
    if (threshold && count > threshold * 1.5) {
      return 'rgba(255, 0, 0, 0.8)';
    } else if (threshold && count > threshold) {
      return 'rgba(255, 153, 0, 0.8)';
    }
    return 'rgba(0, 255, 0, 0.8)';
  });
  
  const ctx = canvas.getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: zones,
      datasets: [{
        label: 'People in Zone',
        data: counts,
        backgroundColor: backgroundColors,
        borderColor: backgroundColors.map(c => c.replace('0.8', '1')),
        borderWidth: 2,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(30, 30, 40, 0.95)',
          titleColor: '#8e2de2',
          bodyColor: '#fff',
          borderColor: '#8e2de2',
          borderWidth: 2
        }
      },
      scales: {
        x: {
          ticks: { color: '#ccc' },
          grid: { display: false }
        },
        y: {
          ticks: { color: '#ccc', beginAtZero: true, stepSize: 1 },
          grid: { color: 'rgba(142, 45, 226, 0.1)' }
        }
      }
    }
  });
  
  canvas.style.height = '200px';
}

function showAlert(alerts) {
  if (!alerts || alerts.length === 0) return;
  
  let alertContainer = document.getElementById('alertContainer');
  if (!alertContainer) {
    alertContainer = document.createElement('div');
    alertContainer.id = 'alertContainer';
    alertContainer.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      width: 350px;
      z-index: 9999;
    `;
    document.body.appendChild(alertContainer);
  }
  
  alerts.forEach(alert => {
    const alertKey = `${alert.zone}-${alert.current}`;
    
    if (activeAlerts.has(alertKey)) return;
    activeAlerts.add(alertKey);
    
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert-notification';
    alertDiv.style.cssText = `
      background: ${alert.severity === 'high' ? 'linear-gradient(135deg, #ff0000 0%, #cc0000 100%)' : 'linear-gradient(135deg, #ff9900 0%, #ff6600 100%)'};
      color: white;
      padding: 15px 20px;
      border-radius: 10px;
      margin-bottom: 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideIn 0.3s ease-out;
      position: relative;
    `;
    
    alertDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong style="font-size: 1.1em;">${alert.message}</strong>
          <div style="font-size: 0.9em; margin-top: 5px; opacity: 0.9;">
            Current: ${alert.current} | Threshold: ${alert.threshold}
          </div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" style="
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          border-radius: 50%;
          width: 30px;
          height: 30px;
          cursor: pointer;
          font-size: 18px;
        ">×</button>
      </div>
    `;
    
    alertContainer.appendChild(alertDiv);
    
    if (alertSound) {
      alertSound.play().catch(e => console.log('Audio play failed:', e));
    }
    
    setTimeout(() => {
      alertDiv.remove();
      activeAlerts.delete(alertKey);
    }, 10000);
  });
}

async function loadZoneThresholds() {
  try {
    const res = await authenticatedFetch(`${API_BASE}/get_zone_thresholds`);
    const data = await res.json();
    
    if (data.success) {
      zoneThresholds = data.thresholds || {};
    }
  } catch (err) {
    console.error('Error loading thresholds:', err);
  }
}

async function setZoneThreshold(zoneName, threshold) {
  try {
    const res = await authenticatedFetch(`${API_BASE}/set_zone_threshold`, {
      method: 'POST',
      body: JSON.stringify({
        zone_name: zoneName,
        threshold: parseInt(threshold)
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      zoneThresholds = data.thresholds;
      alert(`Threshold set for ${zoneName}: ${threshold} people`);
    }
  } catch (err) {
    console.error('Error setting threshold:', err);
    alert('Failed to set threshold');
  }
}

function showThresholdDialog(zoneName) {
  const threshold = prompt(`Set alert threshold for ${zoneName}:`, zoneThresholds[zoneName] || '10');
  
  if (threshold && !isNaN(threshold)) {
    setZoneThreshold(zoneName, threshold);
  }
}

// ==================== IMAGE ANALYSIS ====================

function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  document.getElementById('imageFileName').textContent = file.name;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    uploadedImage = new Image();
    uploadedImage.onload = function() {
      imageCanvas.width = uploadedImage.width;
      imageCanvas.height = uploadedImage.height;
      
      imageCtx.drawImage(uploadedImage, 0, 0);
      
      document.getElementById('imagePlaceholder').style.display = 'none';
      imageCanvas.style.display = 'block';
      document.getElementById('analyzeImageBtn').disabled = false;
      document.getElementById('drawImageZoneBtn').disabled = false;
      document.getElementById('imageStatus').textContent = 'Ready';
    };
    uploadedImage.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function drawImageZone() {
  if (isDrawingImageZone) {
    cancelImageZoneDrawing();
    return;
  }
  
  isDrawingImageZone = true;
  currentImageZonePoints = [];
  document.getElementById('imageDrawingInstructions').style.display = 'block';
  imageCanvas.style.cursor = 'crosshair';
  
  imageCanvas.onclick = function(e) {
    if (!isDrawingImageZone) return;
    
    const rect = imageCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * imageCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * imageCanvas.height;
    
    const point = {x: Math.floor(x), y: Math.floor(y)};
    
    if (currentImageZonePoints.length >= 3) {
      const firstPoint = currentImageZonePoints[0];
      const distance = Math.sqrt(Math.pow(x - firstPoint.x, 2) + Math.pow(y - firstPoint.y, 2));
      
      if (distance < 20) {
        finishImageZone();
        return;
      }
    }
    
    currentImageZonePoints.push(point);
    redrawImageWithZones();
  };
  
  document.onkeydown = function(e) {
    if (e.key === 'Escape' && isDrawingImageZone) {
      cancelImageZoneDrawing();
    }
  };
}

function redrawImageWithZones() {
  imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
  imageCtx.drawImage(uploadedImage, 0, 0);
  
  for (const [zoneName, points] of Object.entries(imageZones)) {
    drawZone(imageCtx, points, 'rgba(0, 255, 0, 0.3)', '#00ff00', zoneName);
  }
  
  if (currentImageZonePoints.length > 0) {
    drawZone(imageCtx, currentImageZonePoints, 'rgba(255, 255, 0, 0.3)', '#ffff00', 'Drawing...');
  }
}

function pointInPolygonJS(x, y, polygon) {
  if (!polygon || polygon.length < 3) {
    return false;
  }
  
  let inside = false;
  const n = polygon.length;
  
  let p1x = polygon[0].x;
  let p1y = polygon[0].y;
  
  for (let i = 0; i < n; i++) {
    const p2x = polygon[(i + 1) % n].x;
    const p2y = polygon[(i + 1) % n].y;
    
    if (y > Math.min(p1y, p2y)) {
      if (y <= Math.max(p1y, p2y)) {
        if (x <= Math.max(p1x, p2x)) {
          let xinters;
          if (p1y !== p2y) {
            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x;
          } else {
            xinters = p1x;
          }
          
          if (p1x === p2x || x <= xinters) {
            inside = !inside;
          }
        }
      }
    }
    
    p1x = p2x;
    p1y = p2y;
  }
  
  return inside;
}

function drawZone(ctx, points, fillColor, strokeColor, label) {
  if (points.length < 1) return;
  
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  
  if (points.length > 2) {
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 3;
  ctx.stroke();
  
  points.forEach((point, idx) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = strokeColor;
    ctx.fill();
    
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText((idx + 1).toString(), point.x, point.y + 20);
  });
  
  if (points.length > 0) {
    const labelX = points[0].x + 10;
    const labelY = points[0].y - 10;
    
    ctx.font = 'bold 16px Arial';
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(labelX - 5, labelY - 18, textWidth + 10, 24);
    
    ctx.fillStyle = strokeColor;
    ctx.textAlign = 'left';
    ctx.fillText(label, labelX, labelY);
  }
}

function drawDetectionWithCenter(ctx, det, color = '#ff00ff') {
  const [x1, y1, x2, y2] = det.bbox;
  const [centerX, centerY] = det.center;
  
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 8, 0, 2 * Math.PI);
  ctx.fill();
  
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX - 12, centerY);
  ctx.lineTo(centerX + 12, centerY);
  ctx.moveTo(centerX, centerY - 12);
  ctx.lineTo(centerX, centerY + 12);
  ctx.stroke();
  
  ctx.fillStyle = color;
  ctx.font = 'bold 16px Arial';
  const label = `Person ${det.id}`;
  ctx.fillText(label, x1, y1 - 5);
  
  ctx.font = '12px Arial';
  ctx.fillStyle = '#fff';
  ctx.fillText(`(${Math.round(centerX)}, ${Math.round(centerY)})`, centerX + 15, centerY);
}

function validateZone(zoneName, zonePoints) {
  console.log(`\n=== Zone Validation: ${zoneName} ===`);
  console.log('Points:', zonePoints);
  
  if (zonePoints.length < 3) {
    console.warn('⚠️ Zone has less than 3 points!');
    return false;
  }
  
  let area = 0;
  for (let i = 0; i < zonePoints.length; i++) {
    const j = (i + 1) % zonePoints.length;
    area += zonePoints[i].x * zonePoints[j].y;
    area -= zonePoints[j].x * zonePoints[i].y;
  }
  area = Math.abs(area / 2);
  
  console.log('Zone area:', area, 'pixels²');
  
  if (area < 100) {
    console.warn('⚠️ Zone area is very small!');
    return false;
  }
  
  let centroidX = 0, centroidY = 0;
  zonePoints.forEach(p => {
    centroidX += p.x;
    centroidY += p.y;
  });
  centroidX /= zonePoints.length;
  centroidY /= zonePoints.length;
  
  const centroidInside = pointInPolygonJS(centroidX, centroidY, zonePoints);
  console.log(`Centroid (${Math.round(centroidX)}, ${Math.round(centroidY)}) inside:`, centroidInside);
  
  if (!centroidInside) {
    console.warn('⚠️ Zone centroid is not inside the polygon!');
  }
  
  console.log('✅ Zone validation complete\n');
  return true;
}

function finishImageZone() {
  if (currentImageZonePoints.length < 3) {
    alert('A zone must have at least 3 points');
    return;
  }
  
  const zoneName = prompt('Enter zone name:', `Zone ${imageZoneCounter}`);
  if (!zoneName) {
    cancelImageZoneDrawing();
    return;
  }
  
  if (!validateZone(zoneName, currentImageZonePoints)) {
    const proceed = confirm('Zone validation warnings detected. Continue anyway?');
    if (!proceed) {
      cancelImageZoneDrawing();
      return;
    }
  }
  
  imageZones[zoneName] = [...currentImageZonePoints];
  imageZoneCounter++;
  
  currentImageZonePoints = [];
  isDrawingImageZone = false;
  imageCanvas.onclick = null;
  document.onkeydown = null;
  document.getElementById('imageDrawingInstructions').style.display = 'none';
  imageCanvas.style.cursor = 'default';
  
  document.getElementById('imageZoneCount').textContent = Object.keys(imageZones).length;
  redrawImageWithZones();
  
  const setThreshold = confirm(`Set alert threshold for ${zoneName}?`);
  if (setThreshold) {
    showThresholdDialog(zoneName);
  }
}

function cancelImageZoneDrawing() {
  currentImageZonePoints = [];
  isDrawingImageZone = false;
  imageCanvas.onclick = null;
  document.onkeydown = null;
  document.getElementById('imageDrawingInstructions').style.display = 'none';
  imageCanvas.style.cursor = 'default';
  redrawImageWithZones();
}

async function analyzeImage() {
  if (!uploadedImage) {
    alert('Please upload an image first');
    return;
  }
  
  document.getElementById('imageStatus').textContent = 'Analyzing...';
  
  try {
    const imageData = imageCanvas.toDataURL('image/jpeg', 0.8);
    
    const res = await authenticatedFetch(`${API_BASE}/analyze_image`, {
      method: 'POST',
      body: JSON.stringify({
        image: imageData,
        zones: imageZones,
        enable_heatmap: enableHeatmap
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('imagePeopleCount').textContent = data.people_count;
      document.getElementById('imageStatus').textContent = 'Complete';
      document.getElementById('saveImageBtn').disabled = false;
      
      redrawImageWithZones();
      
      data.detections.forEach(det => {
        drawDetectionWithCenter(imageCtx, det, '#ff00ff');
      });
      
      if (data.zone_counts && Object.keys(data.zone_counts).length > 0) {
        displayZoneCounts('imageZones', data.zone_counts);
        document.getElementById('imageZoneList').style.display = 'block';
      }
      
      if (data.alerts && data.alerts.length > 0) {
        showAlert(data.alerts);
      }
      
      if (data.heatmap) {
        displayHeatmap('imageHeatmapDisplay', data.heatmap);
      }
      
      alert(`Analysis complete! Found ${data.people_count} people`);
    } else {
      alert('Analysis failed: ' + data.message);
      document.getElementById('imageStatus').textContent = 'Failed';
    }
  } catch (err) {
    console.error('Error analyzing image:', err);
    alert('Error analyzing image');
    document.getElementById('imageStatus').textContent = 'Error';
  }
}

function displayHeatmap(containerId, heatmapData) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = `<img src="data:image/jpeg;base64,${heatmapData}" style="max-width: 100%; border-radius: 8px;" />`;
  container.style.display = 'block';
}

async function saveImageSession() {
  const peopleCount = parseInt(document.getElementById('imagePeopleCount').textContent) || 0;
  
  if (peopleCount === 0) {
    alert('No people detected. Nothing to save.');
    return;
  }
  
  try {
    const zoneCounts = {};
    const zoneItems = document.querySelectorAll('#imageZones .zone-item');
    zoneItems.forEach(item => {
      const name = item.querySelector('.zone-name').textContent;
      const count = parseInt(item.querySelector('.zone-count').textContent);
      zoneCounts[name] = count;
    });
    
    const response = await authenticatedFetch(`${API_BASE}/save_detection`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'image',
        people_count: peopleCount,
        crossed_count: 0,
        zone_counts: zoneCounts
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert('Image analysis saved successfully!');
      loadHomeStats();
    } else {
      alert('Failed to save: ' + (data.message || 'Unknown error'));
    }
  } catch (err) {
    console.error('Error saving session:', err);
    alert('Error saving session');
  }
}

function resetImageAnalysis() {
  uploadedImage = null;
  imageZones = {};
  currentImageZonePoints = [];
  isDrawingImageZone = false;
  imageZoneCounter = 1;
  
  imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
  
  document.getElementById('imageFileName').textContent = '';
  document.getElementById('imagePeopleCount').textContent = '0';
  document.getElementById('imageZoneCount').textContent = '0';
  document.getElementById('imageStatus').textContent = 'Ready';
  document.getElementById('analyzeImageBtn').disabled = true;
  document.getElementById('drawImageZoneBtn').disabled = true;
  document.getElementById('saveImageBtn').disabled = true;
  imageCanvas.style.display = 'none';
  document.getElementById('imagePlaceholder').style.display = 'block';
  document.getElementById('imageZoneList').style.display = 'none';
  document.getElementById('imageDrawingInstructions').style.display = 'none';
}

// ==================== VIDEO ANALYSIS ====================

function handleVideoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  document.getElementById('fileName').textContent = file.name;
  uploadedVideo = document.createElement('video');
  const url = URL.createObjectURL(file);
  uploadedVideo.src = url;
  uploadedVideo.load();
  
  uploadedVideo.onloadedmetadata = function() {
    videoCanvas.width = uploadedVideo.videoWidth;
    videoCanvas.height = uploadedVideo.videoHeight;
    
    videoCtx.drawImage(uploadedVideo, 0, 0);
    
    document.getElementById('videoPlaceholder').style.display = 'none';
    videoCanvas.style.display = 'block';
    document.getElementById('analyzeBtn').disabled = false;
    document.getElementById('drawLineBtn').disabled = false;
    document.getElementById('drawVideoZoneBtn').disabled = false;
  };
}

function drawVideoZone() {
  if (isDrawingVideoZone) {
    cancelVideoZoneDrawing();
    return;
  }
  
  isDrawingVideoZone = true;
  currentVideoZonePoints = [];
  document.getElementById('videoDrawingInstructions').style.display = 'block';
  document.getElementById('videoDrawingMode').textContent = 'Click points to create a zone. Click first point to close or press Escape.';
  videoCanvas.style.cursor = 'crosshair';
  
  videoCanvas.onclick = function(e) {
    if (!isDrawingVideoZone) return;
    
    const rect = videoCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * videoCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * videoCanvas.height;
    
    const point = {x: Math.floor(x), y: Math.floor(y)};
    
    if (currentVideoZonePoints.length >= 3) {
      const firstPoint = currentVideoZonePoints[0];
      const distance = Math.sqrt(Math.pow(x - firstPoint.x, 2) + Math.pow(y - firstPoint.y, 2));
      
      if (distance < 20) {
        finishVideoZone();
        return;
      }
    }
    
    currentVideoZonePoints.push(point);
    redrawVideoFrame();
  };
  
  document.onkeydown = function(e) {
    if (e.key === 'Escape' && isDrawingVideoZone) {
      cancelVideoZoneDrawing();
    }
  };
}

function finishVideoZone() {
  if (currentVideoZonePoints.length < 3) {
    alert('A zone must have at least 3 points');
    return;
  }
  
  const zoneName = prompt('Enter zone name:', `Zone ${videoZoneCounter}`);
  if (!zoneName) {
    cancelVideoZoneDrawing();
    return;
  }
  
  videoZones[zoneName] = [...currentVideoZonePoints];
  videoZoneCounter++;
  
  currentVideoZonePoints = [];
  isDrawingVideoZone = false;
  videoCanvas.onclick = null;
  document.onkeydown = null;
  document.getElementById('videoDrawingInstructions').style.display = 'none';
  videoCanvas.style.cursor = 'default';
  
  document.getElementById('videoZoneCount').textContent = Object.keys(videoZones).length;
  redrawVideoFrame();
  
  const setThreshold = confirm(`Set alert threshold for ${zoneName}?`);
  if (setThreshold) {
    showThresholdDialog(zoneName);
  }
}

function cancelVideoZoneDrawing() {
  currentVideoZonePoints = [];
  isDrawingVideoZone = false;
  videoCanvas.onclick = null;
  document.onkeydown = null;
  document.getElementById('videoDrawingInstructions').style.display = 'none';
  videoCanvas.style.cursor = 'default';
  redrawVideoFrame();
}

function drawVideoLine() {
  if (isDrawingVideoLine) {
    isDrawingVideoLine = false;
    videoLineStart = null;
    videoCanvas.style.cursor = 'default';
    document.getElementById('videoDrawingInstructions').style.display = 'none';
    return;
  }
  
  isDrawingVideoLine = true;
  videoCanvas.style.cursor = 'crosshair';
  document.getElementById('videoDrawingInstructions').style.display = 'block';
  document.getElementById('videoDrawingMode').textContent = 'Click two points to draw a crossing line';
  
  videoCanvas.onclick = function(e) {
    if (!isDrawingVideoLine) return;
    
    const rect = videoCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * videoCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * videoCanvas.height;
    
    if (!videoLineStart) {
      videoLineStart = {x: Math.floor(x), y: Math.floor(y)};
      redrawVideoFrame();
    } else {
      videoLine = {
        start: videoLineStart,
        end: {x: Math.floor(x), y: Math.floor(y)}
      };
      
      isDrawingVideoLine = false;
      videoLineStart = null;
      videoCanvas.onclick = null;
      videoCanvas.style.cursor = 'default';
      document.getElementById('videoDrawingInstructions').style.display = 'none';
      
      redrawVideoFrame();
      alert('Crossing line set!');
    }
  };
}

function redrawVideoFrame() {
  if (!uploadedVideo) return;
  
  videoCtx.clearRect(0, 0, videoCanvas.width, videoCanvas.height);
  videoCtx.drawImage(uploadedVideo, 0, 0);
  
  for (const [zoneName, points] of Object.entries(videoZones)) {
    drawZone(videoCtx, points, 'rgba(0, 255, 0, 0.3)', '#00ff00', zoneName);
  }
  
  if (currentVideoZonePoints.length > 0) {
    drawZone(videoCtx, currentVideoZonePoints, 'rgba(255, 255, 0, 0.3)', '#ffff00', 'Drawing...');
  }
  
  if (videoLine) {
    videoCtx.strokeStyle = '#ff0000';
    videoCtx.lineWidth = 3;
    videoCtx.beginPath();
    videoCtx.moveTo(videoLine.start.x, videoLine.start.y);
    videoCtx.lineTo(videoLine.end.x, videoLine.end.y);
    videoCtx.stroke();
    
    videoCtx.fillStyle = '#ff0000';
    videoCtx.font = 'bold 16px Arial';
    videoCtx.fillText('Crossing Line', videoLine.start.x, videoLine.start.y - 10);
  }
  
  if (videoLineStart) {
    videoCtx.fillStyle = '#ff0000';
    videoCtx.beginPath();
    videoCtx.arc(videoLineStart.x, videoLineStart.y, 5, 0, 2 * Math.PI);
    videoCtx.fill();
  }
}

async function startVideoAnalysis() {
  if (!uploadedVideo) {
    alert('Please upload a video first');
    return;
  }
  
  isAnalyzing = true;
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('pauseBtn').disabled = false;
  document.getElementById('saveVideoBtn').disabled = false;
  
  uploadedVideo.currentTime = 0;
  videoStartTime = Date.now();
  
  await uploadedVideo.play();
  
  videoAnalysisInterval = setInterval(async () => {
    if (uploadedVideo.paused || uploadedVideo.ended) {
      clearInterval(videoAnalysisInterval);
      document.getElementById('analyzeBtn').disabled = false;
      document.getElementById('pauseBtn').disabled = true;
      
      if (uploadedVideo.ended) {
        const autoSave = confirm('Video analysis complete! Save results?');
        if (autoSave) {
          await saveVideoSession();
        }
      }
      return;
    }
    
    videoCtx.drawImage(uploadedVideo, 0, 0, videoCanvas.width, videoCanvas.height);
    
    for (const [zoneName, points] of Object.entries(videoZones)) {
      drawZone(videoCtx, points, 'rgba(0, 255, 0, 0.3)', '#00ff00', zoneName);
    }
    
    if (videoLine) {
      videoCtx.strokeStyle = '#ff0000';
      videoCtx.lineWidth = 3;
      videoCtx.beginPath();
      videoCtx.moveTo(videoLine.start.x, videoLine.start.y);
      videoCtx.lineTo(videoLine.end.x, videoLine.end.y);
      videoCtx.stroke();
      
      videoCtx.fillStyle = '#ff0000';
      videoCtx.font = 'bold 16px Arial';
      videoCtx.fillText('Crossing Line', videoLine.start.x, videoLine.start.y - 10);
    }
    
    const frameData = videoCanvas.toDataURL('image/jpeg', 0.8);
    await analyzeVideoFrame(frameData, Math.floor(uploadedVideo.currentTime * 30));
    
    const elapsed = Math.floor((Date.now() - videoStartTime) / 1000);
    document.getElementById('analysisDuration').textContent = elapsed + 's';
  }, 500);
}

function pauseVideoAnalysis() {
  if (videoAnalysisInterval) {
    clearInterval(videoAnalysisInterval);
    videoAnalysisInterval = null;
  }
  
  if (uploadedVideo) {
    uploadedVideo.pause();
  }
  
  isAnalyzing = false;
  document.getElementById('analyzeBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;
}

async function analyzeVideoFrame(frameData, frameNumber) {
  try {
    const res = await authenticatedFetch(`${API_BASE}/analyze_frame`, {
      method: 'POST',
      body: JSON.stringify({
        frame: frameData,
        frame_number: frameNumber,
        crossing_line: videoLine,
        zones: videoZones
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      if (data.detections) {
        data.detections.forEach((det) => {
          const [x1, y1, x2, y2] = det.bbox;
          
          videoCtx.strokeStyle = '#00ff00';
          videoCtx.lineWidth = 2;
          videoCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          
          videoCtx.fillStyle = '#00ff00';
          videoCtx.font = 'bold 16px Arial';
          videoCtx.fillText(`Person ${det.id}`, x1, y1 - 5);
        });
      }
      
      for (const [zoneName, points] of Object.entries(videoZones)) {
        drawZone(videoCtx, points, 'rgba(0, 255, 0, 0.3)', '#00ff00', zoneName);
      }
      
      if (videoLine) {
        videoCtx.strokeStyle = '#ff0000';
        videoCtx.lineWidth = 3;
        videoCtx.beginPath();
        videoCtx.moveTo(videoLine.start.x, videoLine.start.y);
        videoCtx.lineTo(videoLine.end.x, videoLine.end.y);
        videoCtx.stroke();
      }
      
      const currentPeople = data.people_count || 0;
      const currentCrossings = data.crossed_count || 0;
      
      if (currentPeople > videoMaxPeopleCount) {
        videoMaxPeopleCount = currentPeople;
      }
      
      videoTotalCrossings = currentCrossings;
      
      if (data.zone_counts && Object.keys(data.zone_counts).length > 0) {
        videoZoneCountsData = data.zone_counts;
      }
      
      document.getElementById('videoPeopleCount').textContent = videoMaxPeopleCount;
      document.getElementById('lineCrossings').textContent = videoTotalCrossings;
      
      if (data.zone_counts && Object.keys(data.zone_counts).length > 0) {
        displayZoneCounts('videoZones', data.zone_counts);
        document.getElementById('videoZoneList').style.display = 'block';
      }
      
      if (data.alerts && data.alerts.length > 0) {
        showAlert(data.alerts);
      }
    }
  } catch (err) {
    console.error('Error analyzing frame:', err);
  }
}

async function resetVideoAnalysis() {
  if (videoAnalysisInterval) {
    clearInterval(videoAnalysisInterval);
    videoAnalysisInterval = null;
  }
  
  if (uploadedVideo) {
    uploadedVideo.pause();
    uploadedVideo = null;
  }
  
  videoLine = null;
  videoZones = {};
  currentVideoZonePoints = [];
  isDrawingVideoZone = false;
  isDrawingVideoLine = false;
  videoZoneCounter = 1;
  isAnalyzing = false;
  videoMaxPeopleCount = 0;
  videoTotalCrossings = 0;
  videoZoneCountsData = {};
  
  videoCtx.clearRect(0, 0, videoCanvas.width, videoCanvas.height);
  
  document.getElementById('fileName').textContent = '';
  document.getElementById('videoPeopleCount').textContent = '0';
  document.getElementById('lineCrossings').textContent = '0';
  document.getElementById('videoZoneCount').textContent = '0';
  document.getElementById('analysisDuration').textContent = '0s';
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('pauseBtn').disabled = true;
  document.getElementById('saveVideoBtn').disabled = true;
  videoCanvas.style.display = 'none';
  document.getElementById('videoPlaceholder').style.display = 'block';
  document.getElementById('videoZoneList').style.display = 'none';
  document.getElementById('videoDrawingInstructions').style.display = 'none';
}

// ==================== WEBCAM ANALYSIS ====================

async function startWebcam() {
  try {
    const res = await authenticatedFetch(`${API_BASE}/start_webcam`, {
      method: 'POST'
    });
    
    const data = await res.json();
    
    if (data.success) {
      webcamActive = true;
      document.getElementById('startWebcamBtn').disabled = true;
      document.getElementById('stopWebcamBtn').disabled = false;
      document.getElementById('drawWebcamLineBtn').disabled = false;
      document.getElementById('drawWebcamZoneBtn').disabled = false;
      document.getElementById('saveWebcamBtn').disabled = false;
      
      document.getElementById('webcamPlaceholder').style.display = 'none';
      webcamCanvas.style.display = 'block';
      
      document.getElementById('liveChartDisplay').style.display = 'block';
      document.getElementById('zoneChartDisplay').style.display = 'block';
      
      webcamStartTime = Date.now();
      
      webcamAnalysisInterval = setInterval(getWebcamFrame, 500);
    } else {
      alert('Failed to start webcam: ' + data.message);
    }
  } catch (err) {
    console.error('Error starting webcam:', err);
    alert('Error starting webcam');
  }
}

async function stopWebcam() {
  try {
    if (webcamAnalysisInterval) {
      clearInterval(webcamAnalysisInterval);
      webcamAnalysisInterval = null;
    }
    
    const res = await authenticatedFetch(`${API_BASE}/stop_webcam`, {
      method: 'POST'
    });
    
    const data = await res.json();
    
    if (data.success) {
      webcamActive = false;
      document.getElementById('startWebcamBtn').disabled = false;
      document.getElementById('stopWebcamBtn').disabled = true;
      document.getElementById('drawWebcamLineBtn').disabled = true;
      document.getElementById('drawWebcamZoneBtn').disabled = true;
      
      webcamCtx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
      
      const autoSave = confirm('Save webcam session results?');
      if (autoSave) {
        await saveWebcamSession();
      }
    }
  } catch (err) {
    console.error('Error stopping webcam:', err);
  }
}

async function getWebcamFrame() {
  if (!webcamActive) return;
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/get_webcam_frame`, {
      method: 'POST',
      body: JSON.stringify({
        crossing_line: webcamLine,
        zones: webcamZones,
        enable_heatmap: enableHeatmap
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      const img = new Image();
      img.onload = function() {
        webcamCanvas.width = img.width;
        webcamCanvas.height = img.height;
        webcamCtx.drawImage(img, 0, 0);
      };
      img.src = 'data:image/jpeg;base64,' + data.frame;
      
      const currentCount = data.count || 0;
      document.getElementById('webcamPeopleCount').textContent = currentCount;
      document.getElementById('webcamCrossings').textContent = data.crossed_count || 0;
      
      if (currentCount > maxWebcamPeopleCount) {
        maxWebcamPeopleCount = currentCount;
        document.getElementById('webcamMaxCount').textContent = maxWebcamPeopleCount;
      }
      
      const timestamp = new Date().toLocaleTimeString();
      updateLiveChart(currentCount, timestamp);
      
      if (data.zone_counts && Object.keys(data.zone_counts).length > 0) {
        displayZoneCounts('webcamZones', data.zone_counts);
        document.getElementById('webcamZoneList').style.display = 'block';
        drawZoneBarChart(data.zone_counts);
      }
      
      if (data.alerts && data.alerts.length > 0) {
        showAlert(data.alerts);
      }
    }
  } catch (err) {
    console.error('Error getting webcam frame:', err);
  }
}

function drawWebcamLine() {
  if (isDrawingWebcamLine) {
    isDrawingWebcamLine = false;
    webcamLineStart = null;
    webcamCanvas.style.cursor = 'default';
    document.getElementById('webcamDrawingInstructions').style.display = 'none';
    return;
  }
  
  isDrawingWebcamLine = true;
  webcamCanvas.style.cursor = 'crosshair';
  document.getElementById('webcamDrawingInstructions').style.display = 'block';
  document.getElementById('webcamDrawingMode').textContent = 'Click two points to draw a crossing line';
  
  webcamCanvas.onclick = function(e) {
    if (!isDrawingWebcamLine) return;
    
    const rect = webcamCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * webcamCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * webcamCanvas.height;
    
    if (!webcamLineStart) {
      webcamLineStart = {x: Math.floor(x), y: Math.floor(y)};
    } else {
      webcamLine = {
        start: webcamLineStart,
        end: {x: Math.floor(x), y: Math.floor(y)}
      };
      
      isDrawingWebcamLine = false;
      webcamLineStart = null;
      webcamCanvas.onclick = null;
      webcamCanvas.style.cursor = 'default';
      document.getElementById('webcamDrawingInstructions').style.display = 'none';
      
      alert('Crossing line set!');
    }
  };
}

function drawWebcamZone() {
  if (isDrawingWebcamZone) {
    cancelWebcamZoneDrawing();
    return;
  }
  
  isDrawingWebcamZone = true;
  currentWebcamZonePoints = [];
  document.getElementById('webcamDrawingInstructions').style.display = 'block';
  document.getElementById('webcamDrawingMode').textContent = 'Click points to create a zone. Click first point to close or press Escape.';
  webcamCanvas.style.cursor = 'crosshair';
  
  webcamCanvas.onclick = function(e) {
    if (!isDrawingWebcamZone) return;
    
    const rect = webcamCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * webcamCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * webcamCanvas.height;
    
    const point = {x: Math.floor(x), y: Math.floor(y)};
    
    if (currentWebcamZonePoints.length >= 3) {
      const firstPoint = currentWebcamZonePoints[0];
      const distance = Math.sqrt(Math.pow(x - firstPoint.x, 2) + Math.pow(y - firstPoint.y, 2));
      
      if (distance < 20) {
        finishWebcamZone();
        return;
      }
    }
    
    currentWebcamZonePoints.push(point);
  };
  
  document.onkeydown = function(e) {
    if (e.key === 'Escape' && isDrawingWebcamZone) {
      cancelWebcamZoneDrawing();
    }
  };
}

function finishWebcamZone() {
  if (currentWebcamZonePoints.length < 3) {
    alert('A zone must have at least 3 points');
    return;
  }
  
  const zoneName = prompt('Enter zone name:', `Zone ${webcamZoneCounter}`);
  if (!zoneName) {
    cancelWebcamZoneDrawing();
    return;
  }
  
  webcamZones[zoneName] = [...currentWebcamZonePoints];
  webcamZoneCounter++;
  
  currentWebcamZonePoints = [];
  isDrawingWebcamZone = false;
  webcamCanvas.onclick = null;
  document.onkeydown = null;
  document.getElementById('webcamDrawingInstructions').style.display = 'none';
  webcamCanvas.style.cursor = 'default';
  
  document.getElementById('webcamZoneCount').textContent = Object.keys(webcamZones).length;
  
  const setThreshold = confirm(`Set alert threshold for ${zoneName}?`);
  if (setThreshold) {
    showThresholdDialog(zoneName);
  }
}

function cancelWebcamZoneDrawing() {
  currentWebcamZonePoints = [];
  isDrawingWebcamZone = false;
  webcamCanvas.onclick = null;
  document.onkeydown = null;
  document.getElementById('webcamDrawingInstructions').style.display = 'none';
  webcamCanvas.style.cursor = 'default';
}

async function resetWebcamCrossings() {
  try {
    const res = await authenticatedFetch(`${API_BASE}/reset_webcam_crossings`, {
      method: 'POST'
    });
    
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('webcamCrossings').textContent = '0';
      alert('Crossings and heatmap reset!');
    }
  } catch (err) {
    console.error('Error resetting crossings:', err);
  }
}

async function saveWebcamSession() {
  const peopleCount = maxWebcamPeopleCount;
  const crossings = parseInt(document.getElementById('webcamCrossings').textContent) || 0;
  
  if (peopleCount === 0) {
    alert('No people detected. Nothing to save.');
    return;
  }
  
  try {
    const zoneCounts = {};
    const zoneItems = document.querySelectorAll('#webcamZones .zone-item');
    zoneItems.forEach(item => {
      const name = item.querySelector('.zone-name').textContent;
      const count = parseInt(item.querySelector('.zone-count').textContent);
      zoneCounts[name] = count;
    });
    
    const response = await authenticatedFetch(`${API_BASE}/save_detection`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'webcam',
        people_count: peopleCount,
        crossed_count: crossings,
        zone_counts: zoneCounts
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert('Webcam session saved successfully!');
      loadHomeStats();
    } else {
      alert('Failed to save: ' + (data.message || 'Unknown error'));
    }
  } catch (err) {
    console.error('Error saving session:', err);
    alert('Error saving session');
  }
}

// ==================== VIDEO SESSION SAVE ====================

async function saveVideoSession() {
  if (videoMaxPeopleCount === 0) {
    alert('No people detected. Nothing to save.');
    return;
  }
  
  try {
    const response = await authenticatedFetch(`${API_BASE}/save_detection`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'video',
        people_count: videoMaxPeopleCount,
        crossed_count: videoTotalCrossings,
        zone_counts: videoZoneCountsData
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert('Video analysis saved successfully!');
      loadHomeStats();
    } else {
      alert('Failed to save: ' + (data.message || 'Unknown error'));
    }
  } catch (err) {
    console.error('Error saving video session:', err);
    alert('Error saving session');
  }
}

// ==================== ANALYTICS ====================

async function loadAnalytics(filter) {
  console.log('📊 Loading analytics with filter:', filter);
  
  try {
    const res = await authenticatedFetch(`${API_BASE}/get_analytics`);
    const data = await res.json();
    
    if (!data.success) {
      showAnalyticsError();
      return;
    }
    
    // Update active filter tab
    const filterTabs = document.querySelectorAll('.filter-tab');
    filterTabs.forEach(tab => {
      tab.classList.remove('active');
      if (tab.textContent.toLowerCase().includes(filter) || 
          (filter === 'all' && tab.textContent === 'All')) {
        tab.classList.add('active');
      }
    });
    
    let filteredData = data.analytics || [];
    const now = new Date();
    
    if (filter === 'today') {
      const today = now.toDateString();
      filteredData = filteredData.filter(log => 
        new Date(log.timestamp).toDateString() === today
      );
    } else if (filter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      filteredData = filteredData.filter(log => 
        new Date(log.timestamp) >= weekAgo
      );
    } else if (filter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      filteredData = filteredData.filter(log => 
        new Date(log.timestamp) >= monthAgo
      );
    }
    
    console.log('✅ Filtered analytics data:', filteredData.length, 'records');
    displayAnalyticsTable(filteredData);
  } catch (err) {
    console.error('❌ Error loading analytics:', err);
    showAnalyticsError();
  }
}

function displayAnalyticsTable(data) {
  const tbody = document.getElementById('analyticsTableBody');
  
  if (!data || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 40px; color: #ccc;">
          No analytics data available for this filter.
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = data.map(log => {
    const timestamp = new Date(log.timestamp).toLocaleString();
    let details;
    try {
      details = typeof log.zone_counts === 'string' ? JSON.parse(log.zone_counts) : log.zone_counts;
    } catch (e) {
      details = { type: 'unknown' };
    }
    
    const type = details.type || 'unknown';
    const zones = details.zones ? Object.keys(details.zones).length : 0;
    
    return `
      <tr>
        <td>${timestamp}</td>
        <td><span style="color: #8e2de2; font-weight: bold;">${type}</span></td>
        <td>${log.total_count}</td>
        <td>${zones} zones</td>
      </tr>
    `;
  }).join('');
}

function showAnalyticsError() {
  const tbody = document.getElementById('analyticsTableBody');
  tbody.innerHTML = `
    <tr>
      <td colspan="4" style="text-align: center; padding: 40px; color: #ff6b6b;">
        Error loading analytics data. Please try again.
      </td>
    </tr>
  `;
}

// ==================== SETTINGS ====================

function loadSettings() {
  const storedUser = localStorage.getItem('user');
  if (storedUser) {
    const userData = JSON.parse(storedUser);
    document.getElementById('settingsUsername').textContent = userData.username || '-';
    document.getElementById('settingsEmail').textContent = userData.email || '-';
  }
  
  document.getElementById('enableHeatmapSetting').checked = enableHeatmap;
  
  if (Object.keys(zoneThresholds).length > 0) {
    const thresholdsList = document.getElementById('thresholdsList');
    thresholdsList.innerHTML = '';
    
    for (const [zone, threshold] of Object.entries(zoneThresholds)) {
      const item = document.createElement('div');
      item.className = 'setting-item';
      item.innerHTML = `
        <span class="setting-label">${zone}</span>
        <span class="setting-value">${threshold} people</span>
      `;
      thresholdsList.appendChild(item);
    }
  }
}

function updateHeatmapSetting(enabled) {
  enableHeatmap = enabled;
  const toggleBtns = document.querySelectorAll('#heatmapToggle, #webcamHeatmapToggle');
  toggleBtns.forEach(btn => {
    btn.innerHTML = `<i class="fas fa-fire"></i> Heatmap: ${enabled ? 'ON' : 'OFF'}`;
  });
}

function updateAlertsSetting(enabled) {
  if (!enabled) {
    alertSound = null;
  } else {
    alertSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGGS56+qeSwkLUKXj8LJoHQU2jdXuyH0pBSd+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkLT6Ld8LBpHQY2jdXuyH0pBSd+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkLT6Pj8LJoHQU1i9Puyn4qBSh+zPLaizsKGGS56+qeSwkL');
  }
}

function toggleHeatmap() {
  enableHeatmap = !enableHeatmap;
  const toggleBtns = document.querySelectorAll('#heatmapToggle, #webcamHeatmapToggle');
  toggleBtns.forEach(btn => {
    btn.innerHTML = `<i class="fas fa-fire"></i> Heatmap: ${enableHeatmap ? 'ON' : 'OFF'}`;
  });
  document.getElementById('enableHeatmapSetting').checked = enableHeatmap;
}

// ==================== UTILITY FUNCTIONS ====================

function displayZoneCounts(containerId, zoneCounts) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = '';
  
  for (const [zone, count] of Object.entries(zoneCounts)) {
    const item = document.createElement('div');
    item.className = 'zone-item';
    
    const threshold = zoneThresholds[zone];
    let alertIcon = '';
    if (threshold && count > threshold) {
      alertIcon = '<span style="color: #ff0000; font-size: 1.2em; margin-left: 5px;">⚠️</span>';
    }
    
    item.innerHTML = `
      <div>
        <span class="zone-name">${zone}</span>
        ${alertIcon}
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span class="zone-count">${count}</span>
        <button class="btn" style="padding: 5px 10px; font-size: 0.8em;" onclick="showThresholdDialog('${zone}')">
          <i class="fas fa-bell"></i> ${threshold ? threshold : 'Set'} 
        </button>
      </div>
    `;
    
    container.appendChild(item);
  }
}

// ==================== SECTION SWITCHING FIX ====================

// Override showSection to load settings when switching
const originalShowSection = showSection;
window.showSection = function(section) {
  originalShowSection(section);
  
  if (section === 'settings') {
    loadSettings();
  }
};

// ==================== ADMIN INTEGRATION FIX ====================
// Add this to the END of dashboard-script.js

// Update showSection to handle admin dashboard loading
const originalShowSectionFunc = showSection;

function showSection(section) {
  console.log('🔄 Switching to section:', section);
  
  // Hide all sections
  const sections = document.querySelectorAll('.content-section');
  sections.forEach(s => s.style.display = 'none');
  
  // Remove active class from all menu items
  const menuItems = document.querySelectorAll('.sidebar li[data-section]');
  menuItems.forEach(li => li.classList.remove('active'));
  
  // Show the selected section
  const sectionId = section + 'Section';
  const sectionElement = document.getElementById(sectionId);
  
  if (sectionElement) {
    sectionElement.style.display = 'block';
    console.log('✅ Section displayed:', sectionId);
    
    // Add active class to the corresponding menu item
    const activeMenuItem = document.querySelector(`.sidebar li[data-section="${section}"]`);
    if (activeMenuItem) {
      activeMenuItem.classList.add('active');
    }
    
    // Load section-specific data
    if (section === 'analytics') {
      loadAnalytics('all');
    } else if (section === 'home') {
      loadHomeStats();
    } else if (section === 'dashboard') {
      // Wait for admin script to load, then call loadAdminDashboard
      if (typeof window.loadAdminDashboard === 'function') {
        window.loadAdminDashboard();
      } else {
        // Retry after a short delay if admin script hasn't loaded yet
        setTimeout(() => {
          if (typeof window.loadAdminDashboard === 'function') {
            window.loadAdminDashboard();
          } else {
            console.error('❌ Admin script not loaded');
            alert('Admin dashboard is loading... Please try again in a moment.');
          }
        }, 500);
      }
    } else if (section === 'settings') {
      loadSettings();
    }
  } else {
    console.error('❌ Section not found:', sectionId);
  }
}

// Ensure logout function is globally accessible
window.logout = logout;

console.log('✅ Dashboard integration complete');