🖥️ PC Optimizer WEB

A full-stack web application providing a secure admin dashboard and API backend for managing and validating PC Optimizer software licenses. This system enables administrators to create, validate, and revoke licenses, handle HWID resets, and monitor activity logs — all through a unified web interface powered by Node.js, Express, and Firebase.

📑 Table of Contents

Overview

Features

Tech Stack

Project Structure

Installation

Environment Configuration

Running the Project

API Endpoints

Admin Dashboard

Security

Troubleshooting

Contributors

License

🧩 Overview

PC Optimizer WEB serves as the control panel and backend for the PC Optimizer desktop software. It handles secure license management and validation via Firebase Firestore, allowing administrators to:

Generate and manage software licenses

Validate and register hardware IDs (HWIDs)

Ban or unban HWIDs

Handle HWID reset requests

Configure license and API behavior

Review detailed activity logs

All configuration and credentials are managed via environment variables for production safety.

🚀 Features

🔐 Admin Authentication – Protected admin panel login using environment credentials

🧾 License Management – Create, validate, and delete licenses stored in Firebase

🧠 HWID Handling – Register, ban, or reset user hardware IDs

📡 API Endpoints – License validation and registration APIs for the client software

📜 Activity Logging – All validation, registration, and admin actions logged with timestamps

⚙️ Dynamic Settings – Toggle API access, maintenance mode, device limits, and expiration policy

🧰 Firebase Integration – Firestore database for cloud-based license storage

🧱 Session Management – Secure admin sessions via express-session

🦺 Security Hardening – Implemented with helmet, express-rate-limit, and environment variable secrets

🛠️ Tech Stack
Component	Technology
Frontend	Admin Dashboard (HTML/CSS/JS integrated into Express views)
Backend	Node.js (Express.js 5)
Database	Firebase Firestore
Security	Helmet, express-session, express-rate-limit
Environment Management	dotenv
Logging & Monitoring	Firestore activity logs
📂 Project Structure
PCoptimizer-WEB/
│
├── index.js                # Main application entry point
├── package.json            # Project dependencies & metadata
├── .env                    # Environment configuration (not committed)
└── README.md               # Project documentation

⚙️ Installation

Clone the repository

git clone https://github.com/TheGameisYash/PCoptimizer-WEB.git
cd PCoptimizer-WEB


Install dependencies

npm install


Create an environment file

cp .env.example .env


Then edit .env with your Firebase and admin credentials.

🔐 Environment Configuration

Add the following to your .env file:

# Admin Credentials
ADMIN_USERNAME=yourAdminUsername
ADMIN_PASSWORD=yourSecurePassword

# Session Secret
SESSION_SECRET=yourStrongSessionSecret

# Firebase Service Account (JSON as string)
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"your-project-id","private_key_id":"xxx","private_key":"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n","client_email":"firebase-adminsdk@your-project-id.iam.gserviceaccount.com","client_id":"xxx","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"..."}

# Server Port
PORT=3000


⚠️ Make sure to escape newlines (\n) in the private key if storing in a single-line .env variable.

🧰 Running the Project
npm start


or directly:

node index.js


The server will start on:
📍 http://localhost:3000

🌐 API Endpoints
Endpoint	Method	Description
/api/validate	GET	Validates a license and HWID
/api/register	GET	Registers a new HWID to a license
/api/license-info	GET	Retrieves license details
/api/request-hwid-reset	POST	Submits an HWID reset request
Example Request
GET /api/validate?license=LIC-1234&hwid=ABC123XYZ


Response:

{
  "success": true,
  "code": "VALID",
  "message": "License validation successful",
  "data": {
    "license": "LIC-1234",
    "hwid": "ABC123XYZ",
    "expiry": "2025-12-31T00:00:00Z"
  }
}

🧑‍💻 Admin Dashboard

Once the server is running, access the admin dashboard:

http://localhost:3000/admin


Dashboard Capabilities:

Manage licenses (add/edit/delete)

View HWID reset requests

Manage ban list

Configure global settings

Review activity logs

🛡️ Security

All sensitive data (admin credentials, Firebase keys) stored securely in .env

Session-based authentication for admin panel

Helmet for secure HTTP headers

Express-rate-limit to prevent brute-force attacks

Input validation using express-validator

🧩 Troubleshooting
Issue	Cause	Solution
FIREBASE_SERVICE_ACCOUNT not found	Missing or malformed .env variable	Ensure FIREBASE_SERVICE_ACCOUNT is valid JSON
ADMIN_USERNAME and ADMIN_PASSWORD must be set	Missing admin credentials	Add them to .env
License validation fails	Expired or invalid license key	Check license expiry and registration in Firebase
👥 Contributors

Maintainer:
Yash (TheGameisYash)

Contributions, feedback, and feature requests are always welcome!
