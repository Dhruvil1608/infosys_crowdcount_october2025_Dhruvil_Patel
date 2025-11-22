import hashlib
import mysql.connector

# Your database configuration
DB_CONFIG = {
    'host': 'localhost',
    'user': 'root',
    'password': 'Dhruvil160805',  # PUT YOUR MYSQL PASSWORD HERE
    'database': 'management'
}

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

# Test password hashing
print("=" * 60)
print("🔐 PASSWORD HASH GENERATOR")
print("=" * 60)

test_password = "Admin@123"
generated_hash = hash_password(test_password)

print(f"\nPassword: {test_password}")
print(f"Generated Hash: {generated_hash}")

# Connect to database
print("\n" + "=" * 60)
print("🗄️  DATABASE CHECK")
print("=" * 60)

try:
    connection = mysql.connector.connect(**DB_CONFIG)
    cursor = connection.cursor(dictionary=True)
    
    print("✅ Database connected successfully!")
    
    # Check all users
    cursor.execute("SELECT id, username, email, password, role FROM users")
    users = cursor.fetchall()
    
    print(f"\n📊 Total users in database: {len(users)}")
    print("\n" + "-" * 60)
    
    for user in users:
        print(f"\nUser ID: {user['id']}")
        print(f"Username: {user['username']}")
        print(f"Email: {user['email']}")
        print(f"Role: {user['role']}")
        print(f"Password Hash: {user['password'][:50]}...")
        
        # Check if hash matches
        if user['email'] == 'admin@system.local':
            print("\n🔍 ADMIN USER FOUND!")
            if user['password'] == generated_hash:
                print("✅ Password hash MATCHES! Login should work.")
            else:
                print("❌ Password hash DOES NOT MATCH!")
                print(f"\nExpected: {generated_hash}")
                print(f"Got:      {user['password']}")
                print("\n🔧 Run this SQL to fix:")
                print(f"UPDATE users SET password = '{generated_hash}' WHERE email = 'admin@system.local';")
    
    print("\n" + "=" * 60)
    print("🧪 TEST LOGIN")
    print("=" * 60)
    
    test_email = "admin@system.local"
    test_pass = "Admin@123"
    test_hash = hash_password(test_pass)
    
    cursor.execute(
        "SELECT * FROM users WHERE email = %s AND password = %s",
        (test_email, test_hash)
    )
    
    result = cursor.fetchone()
    
    if result:
        print(f"✅ LOGIN SUCCESSFUL!")
        print(f"   User: {result['username']}")
        print(f"   Role: {result['role']}")
    else:
        print("❌ LOGIN FAILED!")
        print("\nTrying to find user by email only...")
        cursor.execute("SELECT * FROM users WHERE email = %s", (test_email,))
        user = cursor.fetchone()
        
        if user:
            print(f"✅ User exists: {user['username']}")
            print(f"❌ But password hash doesn't match!")
            print(f"\nDatabase has: {user['password']}")
            print(f"Login expects: {test_hash}")
            print(f"\n🔧 FIX: Run this SQL command:")
            print(f"UPDATE users SET password = '{test_hash}' WHERE email = '{test_email}';")
        else:
            print(f"❌ User with email '{test_email}' NOT FOUND!")
            print("\n🔧 FIX: Run this SQL command:")
            print(f"INSERT INTO users (username, email, password, role) VALUES")
            print(f"('administrator', '{test_email}', '{test_hash}', 'admin');")
    
    cursor.close()
    connection.close()
    
except mysql.connector.Error as e:
    print(f"❌ Database Error: {e}")
    print("\n🔧 Check your DB_CONFIG settings:")
    print(f"   Host: {DB_CONFIG['host']}")
    print(f"   User: {DB_CONFIG['user']}")
    print(f"   Database: {DB_CONFIG['database']}")

print("\n" + "=" * 60)
print("✅ Test Complete!")
print("=" * 60)