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
zone_thresholds = {}  # Store threshold limits for each zone
zone_alerts = {}  # Track alert status for each zone

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
def generate_token(user_id, username, email):
    """Generate JWT token"""
    payload = {
        'user_id': user_id,
        'username': username,
        'email': email,
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

# Authentication endpoints
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')
    
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
            "INSERT INTO users (username, email, password) VALUES (%s, %s, %s)",
            (username, email, hashed_password)
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
            token = generate_token(user['id'], user['username'], user['email'])
            
            return jsonify({
                'success': True,
                'message': 'Login successful',
                'token': token,
                'user': {
                    'id': user['id'],
                    'username': user['username'],
                    'email': user['email']
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
        
        # Check if point is on the same horizontal level as the edge
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    # Calculate intersection point
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    else:
                        xinters = p1x
                    
                    # If point is to the left of intersection, toggle inside
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        
        p1x, p1y = p2x, p2y
    
    return inside

def count_people_in_zones(detections, zones):
    """Count how many people are in each zone"""
    zone_counts = {}
    
    # Initialize all zones with 0
    for zone_name in zones.keys():
        zone_counts[zone_name] = 0
    
    # Count people in each zone
    for det in detections:
        center_x, center_y = det['center']
        
        # Check each zone
        for zone_name, zone_points in zones.items():
            if point_in_polygon(center_x, center_y, zone_points):
                zone_counts[zone_name] += 1
                # Don't break - a person can be in multiple overlapping zones
    
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
    
    # Add current detections to heatmap
    for det in detections:
        center_x, center_y = det['center']
        # Create gaussian around each person
        y, x = np.ogrid[:height, :width]
        mask = np.exp(-((x - center_x)**2 + (y - center_y)**2) / (2 * 30**2))
        heatmap_accumulator += mask * 10
    
    # Normalize and apply colormap
    heatmap_normalized = cv2.normalize(heatmap_accumulator, None, 0, 255, cv2.NORM_MINMAX)
    heatmap_colored = cv2.applyColorMap(heatmap_normalized.astype(np.uint8), cv2.COLORMAP_JET)
    
    # Blend with original frame
    overlay = cv2.addWeighted(frame, 0.7, heatmap_colored, 0.3, 0)
    
    return overlay

# ==================== ZONE THRESHOLD MANAGEMENT ====================

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

# ==================== IMAGE ANALYSIS ====================

@app.route('/analyze_image', methods=['POST'])
@token_required
def analyze_image():
    global model
    
    if model is None:
        return jsonify({'success': False, 'message': 'Model not loaded'}), 500
    
    data = request.get_json()
    image_data = data.get('image')
    zones = data.get('zones', {})
    enable_heatmap = data.get('enable_heatmap', False)
    
    if not image_data:
        return jsonify({'success': False, 'message': 'No image data provided'}), 400
    
    try:
        img_data = image_data.split(',')[1] if ',' in image_data else image_data
        img_bytes = base64.b64decode(img_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            return jsonify({'success': False, 'message': 'Failed to decode image'}), 500
        
        results = model(frame, conf=0.5, classes=[0], verbose=False)
        
        detections = []
        
        for result in results:
            boxes = result.boxes
            for idx, box in enumerate(boxes):
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = box.conf[0].item()
                
                center_x = int((x1 + x2) / 2)
                center_y = int((y1 + y2) / 2)
                
                detections.append({
                    'id': idx + 1,
                    'bbox': [int(x1), int(y1), int(x2), int(y2)],
                    'center': [center_x, center_y],
                    'confidence': conf
                })
        
        zone_counts = {}
        alerts = []
        
        if zones:
            zone_counts = count_people_in_zones(detections, zones)
            alerts = check_zone_alerts(zone_counts, zone_thresholds)
        
        response_data = {
            'success': True,
            'people_count': len(detections),
            'detections': detections,
            'zone_counts': zone_counts,
            'alerts': alerts
        }
        
        if enable_heatmap and len(detections) > 0:
            heatmap_frame = generate_heatmap(frame.copy(), detections)
            _, buffer = cv2.imencode('.jpg', heatmap_frame)
            heatmap_base64 = base64.b64encode(buffer).decode('utf-8')
            response_data['heatmap'] = heatmap_base64
        
        return jsonify(response_data), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

# ==================== WEBCAM ANALYSIS ====================

@app.route('/start_webcam', methods=['POST'])
@token_required
def start_webcam():
    global video_capture, person_tracker, next_person_id, heatmap_accumulator
    
    try:
        if video_capture is not None:
            video_capture.release()
        
        video_capture = cv2.VideoCapture(0)
        
        if not video_capture.isOpened():
            return jsonify({'success': False, 'message': 'Failed to open webcam'}), 500
        
        person_tracker = {}
        next_person_id = 1
        heatmap_accumulator = None
        
        return jsonify({'success': True, 'message': 'Webcam started successfully'}), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/stop_webcam', methods=['POST'])
@token_required
def stop_webcam():
    global video_capture, person_tracker, next_person_id, heatmap_accumulator
    
    try:
        if video_capture is not None:
            video_capture.release()
            video_capture = None
        
        person_tracker = {}
        next_person_id = 1
        heatmap_accumulator = None
        
        return jsonify({'success': True, 'message': 'Webcam stopped'}), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/get_webcam_frame', methods=['POST'])
@token_required
def get_webcam_frame():
    global video_capture, model, person_tracker, next_person_id, crossing_line, crossed_persons
    
    if video_capture is None or not video_capture.isOpened():
        return jsonify({'success': False, 'message': 'Webcam not started'}), 400
    
    if model is None:
        return jsonify({'success': False, 'message': 'Model not loaded'}), 500
    
    data = request.get_json() or {}
    if 'crossing_line' in data:
        crossing_line = data['crossing_line']
    
    zones = data.get('zones', {})
    enable_heatmap = data.get('enable_heatmap', False)
    
    ret, frame = video_capture.read()
    
    if not ret:
        return jsonify({'success': False, 'message': 'Failed to read frame'}), 500
    
    results = model(frame, conf=0.5, classes=[0], verbose=False)
    
    current_detections = []
    detected_ids = []
    
    for result in results:
        boxes = result.boxes
        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = box.conf[0].item()
            
            center_x = int((x1 + x2) / 2)
            center_y = int((y1 + y2) / 2)
            
            person_id = assign_person_id(center_x, center_y)
            detected_ids.append(person_id)
            
            current_detections.append({
                'id': person_id,
                'bbox': [int(x1), int(y1), int(x2), int(y2)],
                'center': [center_x, center_y],
                'confidence': conf
            })
            
            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 3)
            
            label = f"Person {person_id}"
            cv2.putText(frame, label, (int(x1), int(y1) - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            
            if crossing_line:
                if check_line_crossing(center_x, center_y, crossing_line):
                    if person_id not in crossed_persons:
                        crossed_persons.add(person_id)
    
    person_tracker = {pid: pos for pid, pos in person_tracker.items() if pid in detected_ids}
    
    zone_counts = {}
    alerts = []
    
    if zones:
        zone_counts = count_people_in_zones(current_detections, zones)
        alerts = check_zone_alerts(zone_counts, zone_thresholds)
    
    if crossing_line:
        start = crossing_line['start']
        end = crossing_line['end']
        cv2.line(frame, (int(start['x']), int(start['y'])), 
                (int(end['x']), int(end['y'])), (0, 0, 255), 4)
        cv2.putText(frame, "Crossing Line", (int(start['x']), int(start['y']) - 10),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
    
    count_text = f"People: {len(current_detections)}"
    cv2.putText(frame, count_text, (20, 50),
               cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 255), 3)
    
    if crossing_line:
        cross_text = f"Crossings: {len(crossed_persons)}"
        cv2.putText(frame, cross_text, (20, 100),
                   cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 0, 255), 3)
    
    _, buffer = cv2.imencode('.jpg', frame)
    frame_base64 = base64.b64encode(buffer).decode('utf-8')
    
    response_data = {
        'success': True,
        'frame': frame_base64,
        'count': len(current_detections),
        'crossed_count': len(crossed_persons),
        'detections': current_detections,
        'zone_counts': zone_counts,
        'alerts': alerts
    }
    
    if enable_heatmap and len(current_detections) > 0:
        heatmap_frame = generate_heatmap(frame.copy(), current_detections)
        _, heatmap_buffer = cv2.imencode('.jpg', heatmap_frame)
        heatmap_base64 = base64.b64encode(heatmap_buffer).decode('utf-8')
        response_data['heatmap'] = heatmap_base64
    
    return jsonify(response_data), 200

def assign_person_id(x, y):
    global person_tracker, next_person_id
    
    for person_id, (px, py) in person_tracker.items():
        distance = np.sqrt((x - px)**2 + (y - py)**2)
        if distance < 100:
            person_tracker[person_id] = (x, y)
            return person_id
    
    new_id = next_person_id
    person_tracker[new_id] = (x, y)
    next_person_id += 1
    return new_id

# ==================== VIDEO ANALYSIS ====================

@app.route('/analyze_frame', methods=['POST'])
@token_required
def analyze_frame():
    global model, crossing_line, crossed_persons
    
    if model is None:
        return jsonify({'success': False, 'message': 'Model not loaded'}), 500
    
    data = request.get_json()
    frame_data = data.get('frame')
    frame_number = data.get('frame_number', 0)
    
    if 'crossing_line' in data:
        crossing_line = data['crossing_line']
    
    zones = data.get('zones', {})
    
    if not frame_data:
        return jsonify({'success': False, 'message': 'No frame data provided'}), 400
    
    try:
        img_data = frame_data.split(',')[1] if ',' in frame_data else frame_data
        img_bytes = base64.b64decode(img_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            return jsonify({'success': False, 'message': 'Failed to decode frame'}), 500
        
        results = model(frame, conf=0.5, classes=[0], verbose=False)
        
        detections = []
        
        for result in results:
            boxes = result.boxes
            for idx, box in enumerate(boxes):
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = box.conf[0].item()
                
                center_x = int((x1 + x2) / 2)
                center_y = int((y1 + y2) / 2)
                
                person_id = idx + 1
                
                detections.append({
                    'id': person_id,
                    'bbox': [int(x1), int(y1), int(x2), int(y2)],
                    'center': [center_x, center_y],
                    'confidence': conf
                })
                
                if crossing_line:
                    if check_line_crossing(center_x, center_y, crossing_line):
                        crossing_key = f"{frame_number}_{person_id}"
                        if crossing_key not in crossed_persons:
                            crossed_persons.add(crossing_key)
        
        zone_counts = {}
        alerts = []
        
        if zones:
            zone_counts = count_people_in_zones(detections, zones)
            alerts = check_zone_alerts(zone_counts, zone_thresholds)
        
        return jsonify({
            'success': True,
            'people_count': len(detections),
            'crossed_count': len(crossed_persons),
            'detections': detections,
            'zone_counts': zone_counts,
            'alerts': alerts
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/get_video_frame', methods=['POST'])
@token_required
def get_video_frame():
    global video_cap, model, crossing_line, crossed_persons
    
    if video_cap is None:
        return jsonify({'success': False, 'message': 'No video loaded'}), 400
    
    if model is None:
        return jsonify({'success': False, 'message': 'Model not loaded'}), 500
    
    data = request.get_json()
    frame_number = data.get('frame_number', 0)
    
    if 'crossing_line' in data:
        crossing_line = data['crossing_line']
    
    zones = data.get('zones', {})
    
    try:
        video_cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = video_cap.read()
        
        if not ret:
            return jsonify({'success': False, 'message': 'Failed to read frame'}), 500
        
        results = model(frame, conf=0.5, classes=[0], verbose=False)
        
        detections = []
        
        for result in results:
            boxes = result.boxes
            for idx, box in enumerate(boxes):
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = box.conf[0].item()
                
                center_x = int((x1 + x2) / 2)
                center_y = int((y1 + y2) / 2)
                
                person_id = idx + 1
                
                detections.append({
                    'id': person_id,
                    'center': [center_x, center_y],
                    'bbox': [int(x1), int(y1), int(x2), int(y2)]
                })
                
                cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 3)
                
                label = f"Person {person_id}"
                cv2.putText(frame, label, (int(x1), int(y1) - 10),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                
                if crossing_line:
                    if check_line_crossing(center_x, center_y, crossing_line):
                        crossing_key = f"{frame_number}_{person_id}"
                        if crossing_key not in crossed_persons:
                            crossed_persons.add(crossing_key)
        
        zone_counts = {}
        alerts = []
        
        if zones:
            zone_counts = count_people_in_zones(detections, zones)
            alerts = check_zone_alerts(zone_counts, zone_thresholds)
        
        if crossing_line:
            start = crossing_line['start']
            end = crossing_line['end']
            cv2.line(frame, (int(start['x']), int(start['y'])), 
                    (int(end['x']), int(end['y'])), (0, 0, 255), 4)
            cv2.putText(frame, "Crossing Line", (int(start['x']), int(start['y']) - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        
        count_text = f"People Detected: {len(detections)}"
        cv2.putText(frame, count_text, (20, 50),
                   cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 255), 3)
        
        if crossing_line:
            cross_text = f"Line Crossings: {len(crossed_persons)}"
            cv2.putText(frame, cross_text, (20, 110),
                       cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 0, 255), 3)
        
        _, buffer = cv2.imencode('.jpg', frame)
        frame_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return jsonify({
            'success': True,
            'frame': frame_base64,
            'people_count': len(detections),
            'crossed_count': len(crossed_persons),
            'detections': detections,
            'zone_counts': zone_counts,
            'alerts': alerts
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/reset_video_analysis', methods=['POST'])
@token_required
def reset_video_analysis():
    global video_cap, uploaded_video_path, crossing_line, crossed_persons
    
    if video_cap is not None:
        video_cap.release()
        video_cap = None
    
    if uploaded_video_path and os.path.exists(uploaded_video_path):
        try:
            os.remove(uploaded_video_path)
        except:
            pass
    
    uploaded_video_path = None
    crossing_line = None
    crossed_persons = set()
    
    return jsonify({'success': True, 'message': 'Analysis reset'}), 200

@app.route('/reset_webcam_crossings', methods=['POST'])
@token_required
def reset_webcam_crossings():
    global crossed_persons, heatmap_accumulator
    crossed_persons = set()
    heatmap_accumulator = None
    return jsonify({'success': True, 'message': 'Crossings and heatmap reset'}), 200

def check_line_crossing(x, y, line):
    if not line:
        return False
        
    x1, y1 = line['start']['x'], line['start']['y']
    x2, y2 = line['end']['x'], line['end']['y']
    
    numerator = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1)
    denominator = np.sqrt((y2 - y1)**2 + (x2 - x1)**2)
    
    if denominator == 0:
        return False
    
    distance = numerator / denominator
    
    return distance < 30
    if not line:
        return False
        
    x1, y1 = line['start']['x'], line['start']['y']
    x2, y2 = line['end']['x'], line['end']['y']
    
    numerator = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1)
    denominator = np.sqrt((y2 - y1)**2 + (x2 - x1)**2)
    
    if denominator == 0:
        return False
    
    distance = numerator / denominator
    
    return distance < 30

# ==================== ANALYTICS ====================

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
    
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor(dictionary=True)
    
    try:
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

@app.route('/test', methods=['GET'])
def test():
    return jsonify({'message': 'Backend is running!', 'model_loaded': model is not None}), 200

if __name__ == '__main__':
    init_model()
    app.run(debug=True, port=5000, threaded=True)