from flask import Flask, request, jsonify
from flask_cors import CORS
import mysql.connector
from mysql.connector import Error
import hashlib
import cv2
import numpy as np
from ultralytics import YOLO
import json
from datetime import datetime
import base64
import os

app = Flask(__name__)
CORS(app)

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
video_cap = None  # For video analysis

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
            return jsonify({
                'success': True,
                'message': 'Login successful',
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

# ==================== WEBCAM ANALYSIS ====================

@app.route('/start_webcam', methods=['POST'])
def start_webcam():
    global video_capture, person_tracker, next_person_id
    
    try:
        if video_capture is not None:
            video_capture.release()
        
        video_capture = cv2.VideoCapture(0)
        
        if not video_capture.isOpened():
            return jsonify({'success': False, 'message': 'Failed to open webcam'}), 500
        
        # Reset tracking
        person_tracker = {}
        next_person_id = 1
        
        return jsonify({'success': True, 'message': 'Webcam started successfully'}), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/stop_webcam', methods=['POST'])
def stop_webcam():
    global video_capture, person_tracker, next_person_id
    
    try:
        if video_capture is not None:
            video_capture.release()
            video_capture = None
        
        person_tracker = {}
        next_person_id = 1
        
        return jsonify({'success': True, 'message': 'Webcam stopped'}), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/get_webcam_frame', methods=['POST'])
def get_webcam_frame():
    global video_capture, model, person_tracker, next_person_id, crossing_line, crossed_persons
    
    if video_capture is None or not video_capture.isOpened():
        return jsonify({'success': False, 'message': 'Webcam not started'}), 400
    
    if model is None:
        return jsonify({'success': False, 'message': 'Model not loaded'}), 500
    
    # Get crossing line from request if provided
    data = request.get_json() or {}
    if 'crossing_line' in data:
        crossing_line = data['crossing_line']
    
    ret, frame = video_capture.read()
    
    if not ret:
        return jsonify({'success': False, 'message': 'Failed to read frame'}), 500
    
    # Run YOLO detection (only person class = 0)
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
            
            # Simple tracking: assign ID based on proximity
            person_id = assign_person_id(center_x, center_y)
            detected_ids.append(person_id)
            
            current_detections.append({
                'id': person_id,
                'bbox': [int(x1), int(y1), int(x2), int(y2)],
                'center': [center_x, center_y],
                'confidence': conf
            })
            
            # Draw bounding box
            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 3)
            
            # Draw person ID
            label = f"Person {person_id}"
            cv2.putText(frame, label, (int(x1), int(y1) - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            
            # Check line crossing
            if crossing_line:
                if check_line_crossing(center_x, center_y, crossing_line):
                    if person_id not in crossed_persons:
                        crossed_persons.add(person_id)
    
    # Clean up old tracked persons
    person_tracker = {pid: pos for pid, pos in person_tracker.items() if pid in detected_ids}
    
    # Draw crossing line if exists
    if crossing_line:
        start = crossing_line['start']
        end = crossing_line['end']
        cv2.line(frame, (int(start['x']), int(start['y'])), 
                (int(end['x']), int(end['y'])), (0, 0, 255), 4)
        cv2.putText(frame, "Crossing Line", (int(start['x']), int(start['y']) - 10),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
    
    # Display count
    count_text = f"People Detected: {len(current_detections)}"
    cv2.putText(frame, count_text, (20, 50),
               cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 255), 3)
    
    if crossing_line:
        cross_text = f"Line Crossings: {len(crossed_persons)}"
        cv2.putText(frame, cross_text, (20, 100),
                   cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 0, 255), 3)
    
    # Encode frame
    _, buffer = cv2.imencode('.jpg', frame)
    frame_base64 = base64.b64encode(buffer).decode('utf-8')
    
    return jsonify({
        'success': True,
        'frame': frame_base64,
        'count': len(current_detections),
        'crossed_count': len(crossed_persons),
        'detections': current_detections
    }), 200

def assign_person_id(x, y):
    global person_tracker, next_person_id
    
    # Check if this person is close to any existing tracked person
    for person_id, (px, py) in person_tracker.items():
        distance = np.sqrt((x - px)**2 + (y - py)**2)
        if distance < 100:  # Threshold for same person
            person_tracker[person_id] = (x, y)
            return person_id
    
    # New person
    new_id = next_person_id
    person_tracker[new_id] = (x, y)
    next_person_id += 1
    return new_id

# ==================== VIDEO ANALYSIS ====================

@app.route('/analyze_frame', methods=['POST'])
def analyze_frame():
    """Analyze a single frame from video"""
    global model, crossing_line, crossed_persons
    
    if model is None:
        return jsonify({'success': False, 'message': 'Model not loaded'}), 500
    
    data = request.get_json()
    frame_data = data.get('frame')
    frame_number = data.get('frame_number', 0)
    
    # Get crossing line from request if provided
    if 'crossing_line' in data:
        crossing_line = data['crossing_line']
    
    if not frame_data:
        return jsonify({'success': False, 'message': 'No frame data provided'}), 400
    
    try:
        # Decode base64 image
        img_data = frame_data.split(',')[1] if ',' in frame_data else frame_data
        img_bytes = base64.b64decode(img_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            return jsonify({'success': False, 'message': 'Failed to decode frame'}), 500
        
        # Run YOLO detection (only person class = 0)
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
                
                # Check line crossing
                if crossing_line:
                    if check_line_crossing(center_x, center_y, crossing_line):
                        crossing_key = f"{frame_number}_{person_id}"
                        if crossing_key not in crossed_persons:
                            crossed_persons.add(crossing_key)
        
        return jsonify({
            'success': True,
            'people_count': len(detections),
            'crossed_count': len(crossed_persons),
            'detections': detections
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/load_video', methods=['POST'])
def load_video():
    """Load video from base64 data"""
    global video_cap, uploaded_video_path
    
    data = request.get_json()
    video_data = data.get('video_data')
    
    if not video_data:
        return jsonify({'success': False, 'message': 'No video data provided'}), 400
    
    try:
        # Save video temporarily
        upload_folder = 'uploads'
        os.makedirs(upload_folder, exist_ok=True)
        
        filename = f"video_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
        uploaded_video_path = os.path.join(upload_folder, filename)
        
        # Decode base64 and save
        video_bytes = base64.b64decode(video_data.split(',')[1] if ',' in video_data else video_data)
        with open(uploaded_video_path, 'wb') as f:
            f.write(video_bytes)
        
        # Open video
        video_cap = cv2.VideoCapture(uploaded_video_path)
        
        if not video_cap.isOpened():
            return jsonify({'success': False, 'message': 'Failed to open video'}), 500
        
        # Get video info
        frame_count = int(video_cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = int(video_cap.get(cv2.CAP_PROP_FPS))
        width = int(video_cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(video_cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        return jsonify({
            'success': True,
            'message': 'Video loaded successfully',
            'frame_count': frame_count,
            'fps': fps,
            'width': width,
            'height': height
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/get_video_frame', methods=['POST'])
def get_video_frame():
    """Get and analyze a specific frame from the video"""
    global video_cap, model, crossing_line, crossed_persons
    
    if video_cap is None:
        return jsonify({'success': False, 'message': 'No video loaded'}), 400
    
    if model is None:
        return jsonify({'success': False, 'message': 'Model not loaded'}), 500
    
    data = request.get_json()
    frame_number = data.get('frame_number', 0)
    
    # Get crossing line from request if provided
    if 'crossing_line' in data:
        crossing_line = data['crossing_line']
    
    try:
        # Set frame position
        video_cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = video_cap.read()
        
        if not ret:
            return jsonify({'success': False, 'message': 'Failed to read frame'}), 500
        
        # Run YOLO detection (only person class = 0)
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
                
                # Draw bounding box
                cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 3)
                
                # Draw person ID
                label = f"Person {person_id}"
                cv2.putText(frame, label, (int(x1), int(y1) - 10),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                
                # Check line crossing
                if crossing_line:
                    if check_line_crossing(center_x, center_y, crossing_line):
                        crossing_key = f"{frame_number}_{person_id}"
                        if crossing_key not in crossed_persons:
                            crossed_persons.add(crossing_key)
        
        # Draw crossing line if exists
        if crossing_line:
            start = crossing_line['start']
            end = crossing_line['end']
            cv2.line(frame, (int(start['x']), int(start['y'])), 
                    (int(end['x']), int(end['y'])), (0, 0, 255), 4)
            cv2.putText(frame, "Crossing Line", (int(start['x']), int(start['y']) - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        
        # Display counts
        count_text = f"People Detected: {len(detections)}"
        cv2.putText(frame, count_text, (20, 50),
                   cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 255), 3)
        
        if crossing_line:
            cross_text = f"Line Crossings: {len(crossed_persons)}"
            cv2.putText(frame, cross_text, (20, 110),
                       cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 0, 255), 3)
        
        # Encode frame
        _, buffer = cv2.imencode('.jpg', frame)
        frame_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return jsonify({
            'success': True,
            'frame': frame_base64,
            'people_count': len(detections),
            'crossed_count': len(crossed_persons),
            'detections': detections
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/reset_video_analysis', methods=['POST'])
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
def reset_webcam_crossings():
    global crossed_persons
    crossed_persons = set()
    return jsonify({'success': True, 'message': 'Crossings reset'}), 200

def check_line_crossing(x, y, line):
    """Check if point (x,y) is near the line"""
    if not line:
        return False
        
    x1, y1 = line['start']['x'], line['start']['y']
    x2, y2 = line['end']['x'], line['end']['y']
    
    # Calculate distance from point to line
    numerator = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1)
    denominator = np.sqrt((y2 - y1)**2 + (x2 - x1)**2)
    
    if denominator == 0:
        return False
    
    distance = numerator / denominator
    
    return distance < 30  # Threshold for crossing

# ==================== ANALYTICS ====================

@app.route('/save_detection', methods=['POST'])
def save_detection():
    data = request.get_json()
    user_id = data.get('user_id')
    detection_type = data.get('type', 'webcam')
    people_count = data.get('people_count', 0)
    crossed_count = data.get('crossed_count', 0)
    
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor()
    
    try:
        cursor.execute(
            "INSERT INTO detection_logs (user_id, zone_counts, total_count, timestamp) VALUES (%s, %s, %s, %s)",
            (user_id, json.dumps({'type': detection_type, 'crossed': crossed_count}), people_count, datetime.now())
        )
        connection.commit()
        
        return jsonify({'success': True, 'message': 'Detection saved'}), 200
        
    except Error as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        
    finally:
        cursor.close()
        connection.close()

@app.route('/get_analytics/<int:user_id>', methods=['GET'])
def get_analytics(user_id):
    connection = get_db_connection()
    if not connection:
        return jsonify({'success': False, 'message': 'Database connection failed'}), 500
    
    cursor = connection.cursor(dictionary=True)
    
    try:
        cursor.execute(
            "SELECT * FROM detection_logs WHERE user_id = %s ORDER BY timestamp DESC LIMIT 50",
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