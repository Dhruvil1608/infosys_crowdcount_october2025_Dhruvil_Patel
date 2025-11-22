from flask import Flask, request, jsonify
from flask_cors import CORS
import mysql.connector
from mysql.connector import Error
import hashlib
import cv2
import numpy as np
from ultralytics import YOLO
import json
from datetime import datetime, timedelta
import base64
import os
import jwt
from functools import wraps
import csv
from io import StringIO, BytesIO
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.lib.units import inch

app = Flask(__name__)
CORS(app)

# JWT Configuration
app.config['SECRET_KEY'] = 'your-secret-key-change-this-in-production'
app.config['JWT_EXPIRATION_HOURS'] = 24

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'user': 'root',
    'password': 'Dhruvil160805',
    'database': 'management'
}

# Global variables
model = None
video_capture = None
uploaded_video_path = None
crossing_line = None
person_tracker = {}
next_person_id = 1
crossed_persons = set()
video_cap = None

# Zone detection variables
detection_zones = {}
zone_thresholds = {}
zone_alerts = {}

# Heatmap data
heatmap_data = None
heatmap_accumulator = None

# Initialize YOLO model
def init_model():
    global model
    try:
        model = YOLO('yolov8n.pt')
        print("✅ YOLO model loaded successfully")
    except Exception as e:
        print(f"❌ Error loading YOLO model: {e}")

# Database functions
def get_db_connection():
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        return connection
    except Error as e:
        print(f"Error connecting to database: {e}")
        return None

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

# JWT Token Functions
def generate_token(user_id, username, email, role='user'):
    """Generate JWT token"""
    payload = {
        'user_id': user_id,
        'username': username,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=app.config['JWT_EXPIRATION_HOURS']),
        'iat': datetime.utcnow()
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

def verify_token(token):
    """Verify JWT token"""
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# JWT Authentication Decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'success': False, 'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'success': False, 'message': 'Token is missing'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'success': False, 'message': 'Token is invalid or expired'}), 401
        
        request.current_user = payload
        return f(*args, **kwargs)
    
    return decorated

# Admin Authentication Decorator
def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'success': False, 'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'success': False, 'message': 'Token is missing'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'success': False, 'message': 'Token is invalid or expired'}), 401
        
        if payload.get('role') != 'admin':
            return jsonify({'success': False, 'message': 'Admin access required'}), 403
        
        request.current_user = payload
        return f(*args, **kwargs)
    
    return decorated

# Authentication endpoints
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')
    role = data.get('role', 'user')
    
    if not username or not email or not password:
        return jsonify({'success': False, 'message': 'All fields are required'}), 400
    
    if len(password) < 6:
        return jsonify({'success': False, 'message': 'Password must be at least 6 characters'}), 400
    
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor()
    
    try:
        cursor.execute("SELECT * FROM users WHERE email = %s", (email,))
        if cursor.fetchone():
            return jsonify({'success': False, 'message': 'Email already registered'}), 400
        
        hashed_password = hash_password(password)
        cursor.execute(
            "INSERT INTO users (username, email, password, role, created_at) VALUES (%s, %s, %s, %s, %s)",
            (username, email, hashed_password, role, datetime.now())
        )
        connection.commit()
        
        return jsonify({'success': True, 'message': 'Registration successful'}), 201
        
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'success': False, 'message': 'Email and password are required'}), 400
    
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor(dictionary=True)
    
    try:
        hashed_password = hash_password(password)
        cursor.execute(
            "SELECT * FROM users WHERE email = %s AND password = %s",
            (email, hashed_password)
        )
        user = cursor.fetchone()
        
        if user:
            role = user.get('role', 'user')
            token = generate_token(user['id'], user['username'], user['email'], role)
            
            # Log activity
            cursor.execute(
                "INSERT INTO user_activity (user_id, activity_type, activity_details, timestamp) VALUES (%s, %s, %s, %s)",
                (user['id'], 'login', 'User logged in', datetime.now())
            )
            connection.commit()
            
            return jsonify({
                'success': True,
                'message': 'Login successful',
                'token': token,
                'user': {
                    'id': user['id'],
                    'username': user['username'],
                    'email': user['email'],
                    'role': role
                }
            }), 200
        else:
            return jsonify({'success': False, 'message': 'Invalid email or password'}), 401
            
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

@app.route('/verify-token', methods=['POST'])
@token_required
def verify_token_endpoint():
    """Endpoint to verify if token is still valid"""
    return jsonify({
        'success': True,
        'message': 'Token is valid',
        'user': request.current_user
    }), 200

# ==================== ADMIN PANEL ENDPOINTS ====================

@app.route('/admin/users', methods=['GET'])
@admin_required
def get_all_users():
    """Get all users for admin panel"""
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor(dictionary=True)
    
    try:
        cursor.execute("SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC")
        users = cursor.fetchall()
        
        # Format dates
        for user in users:
            if user['created_at']:
                user['created_at'] = user['created_at'].isoformat()
        
        return jsonify({'success': True, 'users': users}), 200
        
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    """Delete a user"""
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor()
    
    try:
        cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
        connection.commit()
        
        return jsonify({'success': True, 'message': 'User deleted successfully'}), 200
        
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

@app.route('/admin/users/<int:user_id>/role', methods=['PUT'])
@admin_required
def update_user_role(user_id):
    """Update user role"""
    data = request.get_json()
    new_role = data.get('role', 'user')
    
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor()
    
    try:
        cursor.execute("UPDATE users SET role = %s WHERE id = %s", (new_role, user_id))
        connection.commit()
        
        return jsonify({'success': True, 'message': 'Role updated successfully'}), 200
        
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

@app.route('/admin/activity', methods=['GET'])
@admin_required
def get_user_activity():
    """Get all user activity logs"""
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor(dictionary=True)
    
    try:
        cursor.execute("""
            SELECT ua.*, u.username, u.email 
            FROM user_activity ua 
            LEFT JOIN users u ON ua.user_id = u.id 
            ORDER BY ua.timestamp DESC 
            LIMIT 100
        """)
        activities = cursor.fetchall()
        
        for activity in activities:
            if activity['timestamp']:
                activity['timestamp'] = activity['timestamp'].isoformat()
        
        return jsonify({'success': True, 'activities': activities}), 200
        
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

@app.route('/admin/zones', methods=['GET'])
@admin_required
def get_all_zones():
    """Get all camera zones"""
    return jsonify({
        'success': True,
        'zones': detection_zones,
        'thresholds': zone_thresholds
    }), 200

@app.route('/admin/zones', methods=['POST'])
@admin_required
def create_zone():
    """Create a new zone"""
    data = request.get_json()
    zone_name = data.get('zone_name')
    zone_points = data.get('zone_points')
    threshold = data.get('threshold', 10)
    
    if not zone_name or not zone_points:
        return jsonify({'success': False, 'message': 'Zone name and points required'}), 400
    
    detection_zones[zone_name] = zone_points
    zone_thresholds[zone_name] = threshold
    
    return jsonify({'success': True, 'message': 'Zone created successfully'}), 200

@app.route('/admin/zones/<zone_name>', methods=['DELETE'])
@admin_required
def delete_zone(zone_name):
    """Delete a zone"""
    if zone_name in detection_zones:
        del detection_zones[zone_name]
    if zone_name in zone_thresholds:
        del zone_thresholds[zone_name]
    
    return jsonify({'success': True, 'message': 'Zone deleted successfully'}), 200

@app.route('/admin/export/csv', methods=['POST'])
@admin_required
def export_data_csv():
    """Export detection data to CSV"""
    data = request.get_json()
    start_date = data.get('start_date')
    end_date = data.get('end_date')
    
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor(dictionary=True)
    
    try:
        query = """
            SELECT dl.*, u.username, u.email 
            FROM detection_logs dl 
            LEFT JOIN users u ON dl.user_id = u.id
        """
        params = []
        
        if start_date and end_date:
            query += " WHERE dl.timestamp BETWEEN %s AND %s"
            params = [start_date, end_date]
        
        query += " ORDER BY dl.timestamp DESC"
        
        cursor.execute(query, params)
        logs = cursor.fetchall()
        
        # Create CSV
        output = StringIO()
        writer = csv.writer(output)
        
        # Headers
        writer.writerow(['ID', 'Username', 'Email', 'People Count', 'Zone Data', 'Timestamp'])
        
        # Data rows
        for log in logs:
            zone_data = log['zone_counts'] if isinstance(log['zone_counts'], str) else json.dumps(log['zone_counts'])
            writer.writerow([
                log['id'],
                log['username'],
                log['email'],
                log['total_count'],
                zone_data,
                log['timestamp'].isoformat() if log['timestamp'] else ''
            ])
        
        csv_data = output.getvalue()
        
        return jsonify({
            'success': True,
            'csv_data': base64.b64encode(csv_data.encode()).decode(),
            'filename': f'detection_logs_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
        }), 200
        
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

@app.route('/admin/export/pdf', methods=['POST'])
@admin_required
def export_data_pdf():
    """Export detection data to PDF"""
    data = request.get_json()
    start_date = data.get('start_date')
    end_date = data.get('end_date')
    
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor(dictionary=True)
    
    try:
        query = """
            SELECT dl.*, u.username, u.email 
            FROM detection_logs dl 
            LEFT JOIN users u ON dl.user_id = u.id
        """
        params = []
        
        if start_date and end_date:
            query += " WHERE dl.timestamp BETWEEN %s AND %s"
            params = [start_date, end_date]
        
        query += " ORDER BY dl.timestamp DESC LIMIT 100"
        
        cursor.execute(query, params)
        logs = cursor.fetchall()
        
        # Create PDF
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        elements = []
        
        # Styles
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=24,
            textColor=colors.HexColor('#8e2de2'),
            spaceAfter=30,
            alignment=1
        )
        
        # Title
        elements.append(Paragraph('CrowdCount Detection Report', title_style))
        elements.append(Spacer(1, 0.3*inch))
        
        # Summary
        total_detections = len(logs)
        total_people = sum(log['total_count'] for log in logs)
        
        summary_data = [
            ['Total Records', str(total_detections)],
            ['Total People Detected', str(total_people)],
            ['Report Generated', datetime.now().strftime('%Y-%m-%d %H:%M:%S')]
        ]
        
        summary_table = Table(summary_data, colWidths=[3*inch, 3*inch])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f0f0f0')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))
        
        elements.append(summary_table)
        elements.append(Spacer(1, 0.5*inch))
        
        # Detection logs table
        elements.append(Paragraph('Detection Logs', styles['Heading2']))
        elements.append(Spacer(1, 0.2*inch))
        
        table_data = [['Username', 'People Count', 'Timestamp']]
        
        for log in logs[:50]:  # Limit to 50 records per page
            table_data.append([
                log['username'] or 'N/A',
                str(log['total_count']),
                log['timestamp'].strftime('%Y-%m-%d %H:%M') if log['timestamp'] else 'N/A'
            ])
        
        logs_table = Table(table_data, colWidths=[2*inch, 2*inch, 2*inch])
        logs_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#8e2de2')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 12),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))
        
        elements.append(logs_table)
        
        # Build PDF
        doc.build(elements)
        pdf_data = buffer.getvalue()
        
        return jsonify({
            'success': True,
            'pdf_data': base64.b64encode(pdf_data).decode(),
            'filename': f'detection_report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.pdf'
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

@app.route('/admin/settings/thresholds', methods=['GET'])
@admin_required
def get_all_thresholds():
    """Get all zone thresholds"""
    return jsonify({
        'success': True,
        'thresholds': zone_thresholds
    }), 200

@app.route('/admin/settings/thresholds', methods=['PUT'])
@admin_required
def update_thresholds():
    """Update zone thresholds"""
    data = request.get_json()
    new_thresholds = data.get('thresholds', {})
    
    zone_thresholds.update(new_thresholds)
    
    return jsonify({
        'success': True,
        'message': 'Thresholds updated successfully',
        'thresholds': zone_thresholds
    }), 200

@app.route('/admin/stats', methods=['GET'])
@admin_required
def get_admin_stats():
    """Get comprehensive statistics for admin dashboard"""
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor(dictionary=True)
    
    try:
        # Total users
        cursor.execute("SELECT COUNT(*) as count FROM users")
        total_users = cursor.fetchone()['count']
        
        # Total detections
        cursor.execute("SELECT COUNT(*) as count FROM detection_logs")
        total_detections = cursor.fetchone()['count']
        
        # Today's detections
        cursor.execute("""
            SELECT COUNT(*) as count FROM detection_logs 
            WHERE DATE(timestamp) = CURDATE()
        """)
        today_detections = cursor.fetchone()['count']
        
        # Total people detected
        cursor.execute("SELECT SUM(total_count) as total FROM detection_logs")
        total_people = cursor.fetchone()['total'] or 0
        
        # Active zones
        active_zones = len(detection_zones)
        
        # Recent activity
        cursor.execute("""
            SELECT activity_type, COUNT(*) as count 
            FROM user_activity 
            WHERE DATE(timestamp) = CURDATE() 
            GROUP BY activity_type
        """)
        activity_summary = cursor.fetchall()
        
        return jsonify({
            'success': True,
            'stats': {
                'total_users': total_users,
                'total_detections': total_detections,
                'today_detections': today_detections,
                'total_people': total_people,
                'active_zones': active_zones,
                'activity_summary': activity_summary
            }
        }), 200
        
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

# ==================== EXISTING ENDPOINTS (Keep all existing code) ====================

# Helper function to check if point is in polygon zone
def point_in_polygon(x, y, polygon):
    """Check if point (x,y) is inside polygon using ray casting algorithm"""
    if not polygon or len(polygon) < 3:
        return False
    
    n = len(polygon)
    inside = False
    
    p1x, p1y = polygon[0]['x'], polygon[0]['y']
    
    for i in range(n):
        p2x, p2y = polygon[(i + 1) % n]['x'], polygon[(i + 1) % n]['y']
        
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    else:
                        xinters = p1x
                    
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        
        p1x, p1y = p2x, p2y
    
    return inside

def count_people_in_zones(detections, zones):
    """Count how many people are in each zone"""
    zone_counts = {}
    
    for zone_name in zones.keys():
        zone_counts[zone_name] = 0
    
    for det in detections:
        center_x, center_y = det['center']
        
        for zone_name, zone_points in zones.items():
            if point_in_polygon(center_x, center_y, zone_points):
                zone_counts[zone_name] += 1
    
    return zone_counts

def check_zone_alerts(zone_counts, thresholds):
    """Check if any zone exceeds threshold and return alerts"""
    alerts = []
    
    for zone_name, count in zone_counts.items():
        if zone_name in thresholds:
            threshold = thresholds[zone_name]
            if count > threshold:
                alerts.append({
                    'zone': zone_name,
                    'current': count,
                    'threshold': threshold,
                    'message': f'⚠️ {zone_name} exceeded threshold! ({count}/{threshold})',
                    'severity': 'high' if count > threshold * 1.5 else 'medium'
                })
    
    return alerts

def generate_heatmap(frame, detections):
    """Generate heatmap overlay for person detections"""
    global heatmap_accumulator
    
    height, width = frame.shape[:2]
    
    if heatmap_accumulator is None:
        heatmap_accumulator = np.zeros((height, width), dtype=np.float32)
    
    for det in detections:
        center_x, center_y = det['center']
        y, x = np.ogrid[:height, :width]
        mask = np.exp(-((x - center_x)**2 + (y - center_y)**2) / (2 * 30**2))
        heatmap_accumulator += mask * 10
    
    heatmap_normalized = cv2.normalize(heatmap_accumulator, None, 0, 255, cv2.NORM_MINMAX)
    heatmap_colored = cv2.applyColorMap(heatmap_normalized.astype(np.uint8), cv2.COLORMAP_JET)
    
    overlay = cv2.addWeighted(frame, 0.7, heatmap_colored, 0.3, 0)
    
    return overlay

# [Keep all existing endpoints from original code - analyze_image, webcam, video, etc.]
# Adding remaining essential endpoints for completeness

@app.route('/set_zone_threshold', methods=['POST'])
@token_required
def set_zone_threshold():
    """Set alert threshold for a specific zone"""
    data = request.get_json()
    zone_name = data.get('zone_name')
    threshold = data.get('threshold')
    
    if not zone_name or threshold is None:
        return jsonify({'success': False, 'message': 'Zone name and threshold required'}), 400
    
    zone_thresholds[zone_name] = int(threshold)
    
    return jsonify({
        'success': True,
        'message': f'Threshold set for {zone_name}',
        'thresholds': zone_thresholds
    }), 200

@app.route('/get_zone_thresholds', methods=['GET'])
@token_required
def get_zone_thresholds():
    """Get all zone thresholds"""
    return jsonify({
        'success': True,
        'thresholds': zone_thresholds
    }), 200

@app.route('/save_detection', methods=['POST'])
@token_required
def save_detection():
    data = request.get_json()
    user_id = request.current_user['user_id']
    detection_type = data.get('type', 'webcam')
    people_count = data.get('people_count', 0)
    crossed_count = data.get('crossed_count', 0)
    zone_counts = data.get('zone_counts', {})
    
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor()
    
    try:
        zone_data = {
            'type': detection_type,
            'crossed': crossed_count,
            'zones': zone_counts
        }
        
        cursor.execute(
            "INSERT INTO detection_logs (user_id, zone_counts, total_count, timestamp) VALUES (%s, %s, %s, %s)",
            (user_id, json.dumps(zone_data), people_count, datetime.now())
        )
        
        # Log activity
        cursor.execute(
            "INSERT INTO user_activity (user_id, activity_type, activity_details, timestamp) VALUES (%s, %s, %s, %s)",
            (user_id, 'detection', f'Saved {detection_type} detection with {people_count} people', datetime.now())
        )
        
        connection.commit()
        
        return jsonify({'success': True, 'message': 'Detection saved'}), 200
        
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

@app.route('/get_analytics', methods=['GET'])
@token_required
def get_analytics():
    user_id = request.current_user['user_id']
    role = request.current_user.get('role', 'user')
    
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor(dictionary=True)
    
    try:
        if role == 'admin':
            # Admin can see all logs
            cursor.execute(
                "SELECT * FROM detection_logs ORDER BY timestamp DESC LIMIT 100"
            )
        else:
            # Regular users see only their logs
            cursor.execute(
                "SELECT * FROM detection_logs WHERE user_id = %s ORDER BY timestamp DESC LIMIT 100",
                (user_id,)
            )
        
        logs = cursor.fetchall()
        
        analytics = []
        for log in logs:
            analytics.append({
                'id': log['id'],
                'timestamp': log['timestamp'].isoformat(),
                'zone_counts': json.loads(log['zone_counts']),
                'total_count': log['total_count']
            })
        
        return jsonify({'success': True, 'analytics': analytics}), 200
        
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

# ... (all your existing code above) ...

@app.route('/test', methods=['GET'])
def test():
    return jsonify({'message': 'Backend is running!', 'model_loaded': model is not None}), 200


# ==================== IMAGE & VIDEO ANALYSIS ENDPOINTS ====================
# ADD THESE NEW ENDPOINTS HERE

@app.route('/analyze_image', methods=['POST'])
@token_required
def analyze_image():
    """Analyze uploaded image"""
    data = request.get_json()
    image_data = data.get('image')
    zones = data.get('zones', {})
    
    if not image_data:
        return jsonify({'success': False, 'message': 'No image provided'}), 400
    
    try:
        # Remove base64 prefix
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        
        # Decode image
        image_bytes = base64.b64decode(image_data)
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Run YOLO detection
        results = model(img)
        
        detections = []
        people_count = 0
        
        for result in results:
            boxes = result.boxes
            for box in boxes:
                cls = int(box.cls[0])
                if cls == 0:  # Person class
                    people_count += 1
                    bbox = box.xyxy[0].cpu().numpy()
                    x1, y1, x2, y2 = bbox
                    center_x = int((x1 + x2) / 2)
                    center_y = int((y1 + y2) / 2)
                    
                    detections.append({
                        'id': people_count,
                        'bbox': [int(x1), int(y1), int(x2), int(y2)],
                        'center': [center_x, center_y],
                        'confidence': float(box.conf[0])
                    })
        
        # Count people in zones
        zone_counts = {}
        if zones:
            for zone_name, zone_points in zones.items():
                count = 0
                for det in detections:
                    center_x, center_y = det['center']
                    if point_in_polygon(center_x, center_y, zone_points):
                        count += 1
                zone_counts[zone_name] = count
        
        # Check for alerts
        alerts = []
        for zone_name, count in zone_counts.items():
            if zone_name in zone_thresholds:
                threshold = zone_thresholds[zone_name]
                if count > threshold:
                    alerts.append({
                        'zone': zone_name,
                        'current': count,
                        'threshold': threshold,
                        'message': f'⚠️ {zone_name} exceeded threshold! ({count}/{threshold})',
                        'severity': 'high' if count > threshold * 1.5 else 'medium'
                    })
        
        return jsonify({
            'success': True,
            'people_count': people_count,
            'detections': detections,
            'zone_counts': zone_counts,
            'alerts': alerts
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/analyze_frame', methods=['POST'])
@token_required
def analyze_frame():
    """Analyze video frame"""
    data = request.get_json()
    frame_data = data.get('frame')
    crossing_line = data.get('crossing_line')
    zones = data.get('zones', {})
    
    if not frame_data:
        return jsonify({'success': False, 'message': 'No frame provided'}), 400
    
    try:
        # Decode frame
        if ',' in frame_data:
            frame_data = frame_data.split(',')[1]
        
        image_bytes = base64.b64decode(frame_data)
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Run YOLO detection
        results = model(img)
        
        detections = []
        people_count = 0
        
        for result in results:
            boxes = result.boxes
            for box in boxes:
                cls = int(box.cls[0])
                if cls == 0:  # Person class
                    people_count += 1
                    bbox = box.xyxy[0].cpu().numpy()
                    x1, y1, x2, y2 = bbox
                    center_x = int((x1 + x2) / 2)
                    center_y = int((y1 + y2) / 2)
                    
                    detections.append({
                        'id': people_count,
                        'bbox': [int(x1), int(y1), int(x2), int(y2)],
                        'center': [center_x, center_y]
                    })
        
        # Count zone occupancy
        zone_counts = {}
        if zones:
            for zone_name, zone_points in zones.items():
                count = 0
                for det in detections:
                    center_x, center_y = det['center']
                    if point_in_polygon(center_x, center_y, zone_points):
                        count += 1
                zone_counts[zone_name] = count
        
        return jsonify({
            'success': True,
            'people_count': people_count,
            'detections': detections,
            'zone_counts': zone_counts,
            'crossed_count': 0  # Implement crossing logic if needed
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/start_webcam', methods=['POST'])
@token_required
def start_webcam():
    """Start webcam capture"""
    global video_capture
    
    try:
        video_capture = cv2.VideoCapture(0)
        
        if not video_capture.isOpened():
            return jsonify({'success': False, 'message': 'Could not open webcam'}), 500
        
        return jsonify({'success': True, 'message': 'Webcam started'}), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/stop_webcam', methods=['POST'])
@token_required
def stop_webcam():
    """Stop webcam capture"""
    global video_capture
    
    try:
        if video_capture:
            video_capture.release()
            video_capture = None
        
        return jsonify({'success': True, 'message': 'Webcam stopped'}), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/get_webcam_frame', methods=['POST'])
@token_required
def get_webcam_frame():
    """Get webcam frame with detection"""
    global video_capture
    
    if not video_capture or not video_capture.isOpened():
        return jsonify({'success': False, 'message': 'Webcam not started'}), 400
    
    data = request.get_json()
    crossing_line = data.get('crossing_line')
    zones = data.get('zones', {})
    
    try:
        ret, frame = video_capture.read()
        
        if not ret:
            return jsonify({'success': False, 'message': 'Could not read frame'}), 500
        
        # Run YOLO detection
        results = model(frame)
        
        detections = []
        people_count = 0
        
        for result in results:
            boxes = result.boxes
            for box in boxes:
                cls = int(box.cls[0])
                if cls == 0:  # Person class
                    people_count += 1
                    bbox = box.xyxy[0].cpu().numpy()
                    x1, y1, x2, y2 = bbox
                    center_x = int((x1 + x2) / 2)
                    center_y = int((y1 + y2) / 2)
                    
                    # Draw on frame
                    cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                    cv2.putText(frame, f'Person {people_count}', (int(x1), int(y1)-10),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                    
                    detections.append({
                        'id': people_count,
                        'bbox': [int(x1), int(y1), int(x2), int(y2)],
                        'center': [center_x, center_y]
                    })
        
        # Draw zones
        if zones:
            for zone_name, zone_points in zones.items():
                points = np.array([[p['x'], p['y']] for p in zone_points], np.int32)
                cv2.polylines(frame, [points], True, (0, 255, 0), 2)
                cv2.putText(frame, zone_name, (points[0][0], points[0][1]-10),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        
        # Draw crossing line
        if crossing_line:
            start = crossing_line['start']
            end = crossing_line['end']
            cv2.line(frame, (start['x'], start['y']), (end['x'], end['y']), (0, 0, 255), 3)
        
        # Count zone occupancy
        zone_counts = {}
        if zones:
            for zone_name, zone_points in zones.items():
                count = 0
                for det in detections:
                    center_x, center_y = det['center']
                    if point_in_polygon(center_x, center_y, zone_points):
                        count += 1
                zone_counts[zone_name] = count
        
        # Encode frame
        _, buffer = cv2.imencode('.jpg', frame)
        frame_base64 = base64.b64encode(buffer).decode('utf-8')
        
        # Check for alerts
        alerts = []
        for zone_name, count in zone_counts.items():
            if zone_name in zone_thresholds:
                threshold = zone_thresholds[zone_name]
                if count > threshold:
                    alerts.append({
                        'zone': zone_name,
                        'current': count,
                        'threshold': threshold,
                        'message': f'⚠️ {zone_name} exceeded threshold! ({count}/{threshold})',
                        'severity': 'high' if count > threshold * 1.5 else 'medium'
                    })
        
        return jsonify({
            'success': True,
            'frame': frame_base64,
            'count': people_count,
            'detections': detections,
            'zone_counts': zone_counts,
            'crossed_count': 0,
            'alerts': alerts
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/reset_webcam_crossings', methods=['POST'])
@token_required
def reset_webcam_crossings():
    """Reset webcam crossing counter"""
    global crossed_persons, heatmap_accumulator
    
    crossed_persons = set()
    heatmap_accumulator = None
    
    return jsonify({'success': True, 'message': 'Crossings and heatmap reset'}), 200


# ==================== END OF NEW ENDPOINTS ====================

if __name__ == '__main__':
    init_model()
    app.run(debug=True, port=5000, threaded=True)
    