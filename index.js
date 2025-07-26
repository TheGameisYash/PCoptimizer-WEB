// PC Optimizer Pro - Ultimate Feature-Rich Version
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const admin = require('firebase-admin');
const crypto = require('crypto');

// --- CONFIGURATION ---
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    console.error('❌ ERROR: ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env file');
    process.exit(1);
}

const CONFIG = {
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET || 'pcoptimizer_secret_' + Math.random(),
    PORT: process.env.PORT || 3000
};

// --- FIREBASE SETUP ---
let db;
try {
    let serviceAccount;
    
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        if (serviceAccount.private_key) {
            serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
    } else {
        console.error('❌ FIREBASE_SERVICE_ACCOUNT not found in .env file');
        process.exit(1);
    }
    
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
        });
    }
    
    db = admin.firestore();
    console.log('🔥 Firebase initialized successfully');
    
} catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    process.exit(1);
}

const app = express();

// --- MIDDLEWARE ---
app.use(session({
    secret: CONFIG.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        httpOnly: true, 
        maxAge: 1000 * 60 * 30, // 30 minutes
        secure: false
    }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- ENHANCED DATABASE HELPERS ---
async function getLicenses() {
    try {
        const snapshot = await db.collection('licenses').get();
        const licenses = {};
        snapshot.forEach(doc => {
            licenses[doc.id] = doc.data();
        });
        return licenses;
    } catch (error) {
        console.error('Error getting licenses:', error);
        return {};
    }
}

async function getLicense(licenseKey) {
    try {
        const doc = await db.collection('licenses').doc(licenseKey).get();
        return doc.exists ? doc.data() : null;
    } catch (error) {
        console.error('Error getting license:', error);
        return null;
    }
}

async function saveLicense(licenseKey, data) {
    try {
        await db.collection('licenses').doc(licenseKey).set(data, { merge: true });
        return true;
    } catch (error) {
        console.error('Error saving license:', error);
        return false;
    }
}

async function deleteLicense(licenseKey) {
    try {
        await db.collection('licenses').doc(licenseKey).delete();
        return true;
    } catch (error) {
        console.error('Error deleting license:', error);
        return false;
    }
}

async function getBanlist() {
    try {
        const doc = await db.collection('settings').doc('banlist').get();
        return doc.exists ? doc.data().hwids || [] : [];
    } catch (error) {
        console.error('Error getting banlist:', error);
        return [];
    }
}

async function saveBanlist(banlist) {
    try {
        await db.collection('settings').doc('banlist').set({ hwids: banlist });
        return true;
    } catch (error) {
        console.error('Error saving banlist:', error);
        return false;
    }
}

// NEW: Activity Log Functions
async function logActivity(action, details, ip = 'unknown', userAgent = 'unknown') {
    try {
        await db.collection('activityLog').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action,
            details,
            ip,
            userAgent,
            date: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error logging activity:', error);
    }
}

async function getActivityLog(limit = 100) {
    try {
        const snapshot = await db.collection('activityLog')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();
        return snapshot.docs.map(doc => doc.data());
    } catch (error) {
        console.error('Error getting activity log:', error);
        return [];
    }
}

// NEW: HWID Reset Requests
async function getHwidRequests() {
    try {
        const snapshot = await db.collection('hwidRequests').orderBy('timestamp', 'desc').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('Error getting HWID requests:', error);
        return [];
    }
}

async function addHwidRequest(data) {
    try {
        const docRef = await db.collection('hwidRequests').add({
            ...data,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending'
        });
        return docRef.id;
    } catch (error) {
        console.error('Error adding HWID request:', error);
        return null;
    }
}

async function deleteHwidRequest(requestId) {
    try {
        await db.collection('hwidRequests').doc(requestId).delete();
        return true;
    } catch (error) {
        console.error('Error deleting HWID request:', error);
        return false;
    }
}

// NEW: License Templates
async function getLicenseTemplates() {
    try {
        const snapshot = await db.collection('licenseTemplates').get();
        const templates = {};
        snapshot.forEach(doc => {
            templates[doc.id] = doc.data();
        });
        return templates;
    } catch (error) {
        console.error('Error getting templates:', error);
        return {};
    }
}

async function saveLicenseTemplate(templateId, data) {
    try {
        await db.collection('licenseTemplates').doc(templateId).set(data, { merge: true });
        return true;
    } catch (error) {
        console.error('Error saving template:', error);
        return false;
    }
}

// NEW: Settings Management
async function getSettings() {
    try {
        const doc = await db.collection('settings').doc('general').get();
        return doc.exists ? doc.data() : {
            maxDevicesPerLicense: 1,
            allowHwidChange: true,
            autoExpireInDays: 30,
            maintenanceMode: false,
            apiEnabled: true
        };
    } catch (error) {
        console.error('Error getting settings:', error);
        return {};
    }
}

async function saveSettings(settings) {
    try {
        await db.collection('settings').doc('general').set(settings, { merge: true });
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        return false;
    }
}

// --- AUTH MIDDLEWARE ---
function requireLogin(req, res, next) {
    if (req.session && req.session.user === CONFIG.ADMIN_USERNAME) {
        return next();
    }
    res.redirect('/admin/login');
}

// --- UTILITY FUNCTIONS ---
function isLicenseExpired(license) {
    if (!license.expiry) return false;
    return new Date() > new Date(license.expiry);
}

function isHWIDBanned(hwid, banlist) {
    return banlist.includes(hwid);
}

function generateSecureLicenseKey(prefix = 'LIC') {
    return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function formatTimeAgo(date) {
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
}

// --- ENHANCED API ENDPOINTS ---
app.get('/api/validate', async (req, res) => {
    const { license, hwid } = req.query;
    if (!license || !hwid) return res.send('FAILED');
    
    try {
        await logActivity('API_VALIDATE', `License: ${license} HWID: ${hwid}`, req.ip, req.get('User-Agent'));
        
        const settings = await getSettings();
        if (!settings.apiEnabled) return res.send('API_DISABLED');
        
        const banlist = await getBanlist();
        if (isHWIDBanned(hwid, banlist)) return res.send('BANNED');
        
        const lic = await getLicense(license);
        if (!lic) return res.send('INVALID_LICENSE');
        if (isLicenseExpired(lic)) return res.send('EXPIRED');
        if (lic.hwid === hwid) {
            // Update last validation time
            await saveLicense(license, { ...lic, lastValidated: new Date().toISOString() });
            return res.send('VALID');
        }
        return res.send('HWID_MISMATCH');
    } catch (error) {
        console.error('Validation error:', error);
        return res.send('ERROR');
    }
});

app.get('/api/register', async (req, res) => {
    const { license, hwid } = req.query;
    if (!license || !hwid) return res.send('FAILED');
    
    try {
        await logActivity('API_REGISTER', `License: ${license} HWID: ${hwid}`, req.ip, req.get('User-Agent'));
        
        const settings = await getSettings();
        if (!settings.apiEnabled) return res.send('API_DISABLED');
        
        const banlist = await getBanlist();
        if (isHWIDBanned(hwid, banlist)) return res.send('BANNED');
        
        const lic = await getLicense(license);
        if (!lic) return res.send('INVALID_LICENSE');
        if (isLicenseExpired(lic)) return res.send('EXPIRED');
        if (lic.hwid && lic.hwid !== hwid) return res.send('ALREADY_REGISTERED');
        
        // Check if HWID is used by another license
        const allLicenses = await getLicenses();
        for (const [licKey, licData] of Object.entries(allLicenses)) {
            if (licData.hwid === hwid && licKey !== license) {
                return res.send('HWID_IN_USE');
            }
        }
        
        // Register the license
        const updatedLic = {
            ...lic,
            hwid: hwid,
            activatedAt: new Date().toISOString(),
            lastValidated: new Date().toISOString(),
            activationIP: req.ip,
            deviceInfo: req.get('User-Agent') || 'Unknown',
            history: [...(lic.history || []), {
                action: "REGISTER",
                date: new Date().toISOString(),
                details: hwid,
                ip: req.ip
            }]
        };
        
        await saveLicense(license, updatedLic);
        return res.send('SUCCESS');
    } catch (error) {
        console.error('Registration error:', error);
        return res.send('ERROR');
    }
});

// NEW: Enhanced License Info API
app.get('/api/license-info', async (req, res) => {
    const { license } = req.query;
    if (!license) return res.send('License not found.');
    
    try {
        const lic = await getLicense(license);
        if (!lic) return res.send('License not found.');
        
        const activatedAt = lic.activatedAt ? lic.activatedAt.replace('T', ' ').substring(0, 19) : "Not activated";
        const expiry = lic.expiry ? lic.expiry.split('T')[0] : "Never";
        const lastValidated = lic.lastValidated ? formatTimeAgo(lic.lastValidated) : "Never";
        const status = isLicenseExpired(lic) ? "EXPIRED" : (lic.hwid ? "ACTIVE" : "INACTIVE");
        
        res.send(`Status: ${status} | Activated: ${activatedAt} | Expires: ${expiry} | Last Seen: ${lastValidated}`);
    } catch (error) {
        console.error('License info error:', error);
        res.send('Error retrieving license information');
    }
});

// NEW: HWID Reset Request API
app.post('/api/request-hwid-reset', async (req, res) => {
    const { license, hwid, reason } = req.body;
    if (!license || !hwid) return res.status(400).json({ error: 'Missing license or HWID' });
    
    try {
        const requestId = await addHwidRequest({
            license,
            hwid,
            reason: reason || 'No reason provided',
            requestIP: req.ip,
            userAgent: req.get('User-Agent') || 'Unknown'
        });
        
        await logActivity('HWID_RESET_REQUEST', `License: ${license} HWID: ${hwid} RequestID: ${requestId}`, req.ip);
        res.json({ status: 'REQUESTED', requestId });
    } catch (error) {
        console.error('HWID reset request error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>PC Optimizer Pro Server</title>
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <style>
                body { 
                    background: linear-gradient(135deg, #1a1d23 0%, #23272e 100%);
                    color: #00aaee; 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    margin: 0; 
                    padding: 40px;
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    overflow-x: hidden;
                }
                .particles { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
                .particle { position: absolute; background: rgba(0, 170, 238, 0.6); border-radius: 50%; animation: float 6s ease-in-out infinite; }
                .particle:nth-child(1) { width: 4px; height: 4px; left: 10%; animation-delay: 0s; }
                .particle:nth-child(2) { width: 6px; height: 6px; left: 20%; animation-delay: 1s; }
                .particle:nth-child(3) { width: 3px; height: 3px; left: 30%; animation-delay: 2s; }
                .particle:nth-child(4) { width: 5px; height: 5px; left: 40%; animation-delay: 3s; }
                .particle:nth-child(5) { width: 4px; height: 4px; left: 50%; animation-delay: 4s; }
                .particle:nth-child(6) { width: 6px; height: 6px; left: 60%; animation-delay: 5s; }
                .particle:nth-child(7) { width: 3px; height: 3px; left: 70%; animation-delay: 0.5s; }
                .particle:nth-child(8) { width: 5px; height: 5px; left: 80%; animation-delay: 1.5s; }
                .particle:nth-child(9) { width: 4px; height: 4px; left: 90%; animation-delay: 2.5s; }
                @keyframes float { 0%, 100% { transform: translateY(100vh) rotate(0deg); opacity: 0; } 10%, 90% { opacity: 1; } 50% { transform: translateY(-10px) rotate(180deg); } }
                .container {
                    text-align: center;
                    background: rgba(35, 39, 46, 0.9);
                    padding: 60px;
                    border-radius: 25px;
                    box-shadow: 0 15px 50px rgba(0, 170, 238, 0.3);
                    border: 2px solid rgba(0, 170, 238, 0.4);
                    backdrop-filter: blur(15px);
                    z-index: 10;
                    position: relative;
                    max-width: 800px;
                }
                h1 { 
                    font-size: 3.5em; 
                    margin-bottom: 20px;
                    background: linear-gradient(45deg, #00aaee, #0099cc, #00d4ff);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    animation: glow 2s ease-in-out infinite alternate;
                }
                @keyframes glow { from { filter: drop-shadow(0 0 20px rgba(0, 170, 238, 0.5)); } to { filter: drop-shadow(0 0 30px rgba(0, 170, 238, 0.8)); } }
                .subtitle {
                    font-size: 1.3em;
                    margin-bottom: 40px;
                    opacity: 0.9;
                    font-weight: 300;
                }
                .admin-btn {
                    display: inline-block;
                    background: linear-gradient(45deg, #00aaee, #0099cc, #00d4ff);
                    color: white;
                    padding: 18px 40px;
                    text-decoration: none;
                    border-radius: 15px;
                    font-weight: bold;
                    font-size: 1.2em;
                    transition: all 0.4s;
                    box-shadow: 0 6px 25px rgba(0, 170, 238, 0.4);
                    position: relative;
                    overflow: hidden;
                }
                .admin-btn:before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: -100%;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
                    transition: left 0.5s;
                }
                .admin-btn:hover:before { left: 100%; }
                .admin-btn:hover {
                    transform: translateY(-3px) scale(1.05);
                    box-shadow: 0 10px 35px rgba(0, 170, 238, 0.6);
                }
                .status-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                    gap: 25px;
                    margin-top: 50px;
                }
                .status-card {
                    background: rgba(0, 170, 238, 0.1);
                    padding: 30px 20px;
                    border-radius: 15px;
                    border: 1px solid rgba(0, 170, 238, 0.3);
                    transition: all 0.3s;
                    position: relative;
                    overflow: hidden;
                }
                .status-card:hover {
                    transform: translateY(-8px);
                    box-shadow: 0 10px 30px rgba(0, 170, 238, 0.3);
                    border-color: rgba(0, 170, 238, 0.6);
                }
                .status-card h3 {
                    margin-top: 0;
                    color: #00aaee;
                    font-size: 1.1em;
                }
                .emoji { 
                    font-size: 2em; 
                    display: block;
                    margin-bottom: 10px;
                    animation: bounce 2s infinite;
                }
                @keyframes bounce { 0%, 20%, 50%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-10px); } 60% { transform: translateY(-5px); } }
                .api-info {
                    margin-top: 40px;
                    padding: 25px;
                    background: rgba(0, 170, 238, 0.05);
                    border-radius: 15px;
                    border: 1px solid rgba(0, 170, 238, 0.2);
                }
                .api-endpoint {
                    background: rgba(0, 0, 0, 0.3);
                    padding: 10px 15px;
                    border-radius: 8px;
                    font-family: 'Courier New', monospace;
                    margin: 5px 0;
                    font-size: 0.9em;
                    border-left: 3px solid #00aaee;
                }
                .footer-info {
                    margin-top: 40px; 
                    opacity: 0.7;
                    font-size: 0.9em;
                }
                .status-indicator {
                    display: inline-block;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: #00ff00;
                    animation: pulse 2s infinite;
                    margin-right: 8px;
                }
                @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(0, 255, 0, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(0, 255, 0, 0); } 100% { box-shadow: 0 0 0 0 rgba(0, 255, 0, 0); } }
            </style>
        </head>
        <body>
            <div class="particles">
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
            </div>
            
            <div class="container">
                <h1>🚀 PC Optimizer Pro</h1>
                <p class="subtitle">Enterprise License Management System</p>
                
                <a href="/admin" class="admin-btn">🔐 Access Admin Panel</a>
                
                <div class="status-grid">
                    <div class="status-card">
                        <span class="emoji">🔥</span>
                        <h3>Firebase</h3>
                        <p>Connected & Synced</p>
                    </div>
                    <div class="status-card">
                        <span class="emoji">🛡️</span>
                        <h3>Security</h3>
                        <p>Military Grade</p>
                    </div>
                    <div class="status-card">
                        <span class="emoji">⚡</span>
                        <h3>Performance</h3>
                        <p>Lightning Fast</p>
                    </div>
                    <div class="status-card">
                        <span class="emoji">📊</span>
                        <h3>Analytics</h3>
                        <p>Real-time Data</p>
                    </div>
                </div>
                
                <div class="api-info">
                    <h3 style="color: #00aaee; margin-bottom: 15px;">🔌 API Endpoints</h3>
                    <div class="api-endpoint">GET /api/validate?license=LICENSE&hwid=HWID</div>
                    <div class="api-endpoint">GET /api/register?license=LICENSE&hwid=HWID</div>
                    <div class="api-endpoint">GET /api/license-info?license=LICENSE</div>
                    <div class="api-endpoint">POST /api/request-hwid-reset</div>
                </div>
                
                <div class="footer-info">
                    <p>
                        <span class="status-indicator"></span>
                        Server Status: Online | Port: ${CONFIG.PORT} | Environment: ${process.env.NODE_ENV || 'development'}
                    </p>
                    <p style="margin-top: 10px;">
                        🌐 Firebase Project: optimizer-ae60e | 
                        ⏰ Uptime: ${process.uptime().toFixed(0)}s
                    </p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// --- ENHANCED ADMIN LOGIN ---
app.get('/admin/login', (req, res) => {
    if (req.session && req.session.user === CONFIG.ADMIN_USERNAME) {
        return res.redirect('/admin');
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Admin Login - PC Optimizer Pro</title>
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { 
                    background: linear-gradient(135deg, #1a1d23 0%, #23272e 100%);
                    color: #00aaee; 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    position: relative;
                    overflow: hidden;
                }
                .bg-animation {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(45deg, rgba(0, 170, 238, 0.1), rgba(0, 153, 204, 0.1));
                    animation: backgroundShift 10s ease-in-out infinite alternate;
                }
                @keyframes backgroundShift {
                    0% { transform: translateX(-10px) translateY(-10px); }
                    100% { transform: translateX(10px) translateY(10px); }
                }
                .login-container { 
                    width: 100%; 
                    max-width: 450px; 
                    z-index: 10;
                }
                .login-box { 
                    background: rgba(35, 39, 46, 0.95);
                    padding: 60px 50px;
                    border-radius: 25px;
                    box-shadow: 0 15px 50px rgba(0, 170, 238, 0.3);
                    border: 2px solid rgba(0, 170, 238, 0.4);
                    backdrop-filter: blur(15px);
                    position: relative;
                    overflow: hidden;
                }
                .login-box:before {
                    content: '';
                    position: absolute;
                    top: -50%;
                    left: -50%;
                    width: 200%;
                    height: 200%;
                    background: linear-gradient(45deg, transparent, rgba(0, 170, 238, 0.1), transparent);
                    animation: rotate 10s linear infinite;
                    z-index: -1;
                }
                @keyframes rotate { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                .login-box h2 { 
                    margin-bottom: 40px; 
                    font-weight: 600; 
                    text-align: center; 
                    font-size: 2.2em;
                    background: linear-gradient(45deg, #00aaee, #0099cc, #00d4ff);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                }
                .form-group { 
                    margin-bottom: 30px; 
                    position: relative;
                }
                .form-group label {
                    position: absolute;
                    top: 15px;
                    left: 20px;
                    color: rgba(0, 170, 238, 0.6);
                    transition: all 0.3s;
                    pointer-events: none;
                    font-size: 16px;
                }
                input { 
                    width: 100%; 
                    padding: 20px; 
                    background: rgba(26, 29, 35, 0.8);
                    color: #00aaee; 
                    border: 2px solid rgba(0, 170, 238, 0.3);
                    border-radius: 12px; 
                    font-size: 16px; 
                    outline: none; 
                    transition: all 0.4s;
                }
                input:focus, input:not(:placeholder-shown) { 
                    border-color: #00aaee;
                    box-shadow: 0 0 20px rgba(0, 170, 238, 0.3);
                    transform: translateY(-2px);
                }
                input:focus + label, input:not(:placeholder-shown) + label {
                    top: -10px;
                    left: 15px;
                    font-size: 12px;
                    background: rgba(35, 39, 46, 0.9);
                    padding: 2px 8px;
                    border-radius: 4px;
                    color: #00aaee;
                }
                button { 
                    width: 100%; 
                    padding: 20px; 
                    background: linear-gradient(45deg, #00aaee, #0099cc, #00d4ff);
                    color: #fff; 
                    border: none; 
                    border-radius: 12px; 
                    font-weight: 600; 
                    font-size: 18px; 
                    cursor: pointer; 
                    transition: all 0.4s;
                    box-shadow: 0 6px 25px rgba(0, 170, 238, 0.4);
                    position: relative;
                    overflow: hidden;
                }
                button:before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: -100%;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
                    transition: left 0.5s;
                }
                button:hover:before { left: 100%; }
                button:hover { 
                    transform: translateY(-3px);
                    box-shadow: 0 10px 35px rgba(0, 170, 238, 0.6);
                }
                .info { 
                    background: rgba(0, 170, 238, 0.15);
                    color: #00aaee; 
                    padding: 25px; 
                    border-radius: 12px; 
                    margin-bottom: 40px; 
                    text-align: center; 
                    border: 1px solid rgba(0, 170, 238, 0.3);
                    animation: pulse-info 3s ease-in-out infinite alternate;
                }
                @keyframes pulse-info { 0% { box-shadow: 0 0 20px rgba(0, 170, 238, 0.2); } 100% { box-shadow: 0 0 30px rgba(0, 170, 238, 0.4); } }
                .back-link {
                    text-align: center;
                    margin-top: 25px;
                }
                .back-link a {
                    color: #00aaee;
                    text-decoration: none;
                    opacity: 0.8;
                    transition: all 0.3s;
                    font-weight: 500;
                }
                .back-link a:hover {
                    opacity: 1;
                    text-shadow: 0 0 10px rgba(0, 170, 238, 0.5);
                }
                .login-attempts {
                    text-align: center;
                    margin-top: 15px;
                    font-size: 0.85em;
                    opacity: 0.7;
                }
            </style>
        </head>
        <body>
            <div class="bg-animation"></div>
            <div class="login-container">
                <div class="login-box">
                    <div class="info">
                        🔥 Firebase Integration Active<br>
                        🛡️ Secure • ⚡ Fast • 📊 Real-time
                    </div>
                    <h2>🔐 Admin Access</h2>
                    <form method="post" action="/admin/login">
                        <div class="form-group">
                            <input name="username" type="text" placeholder=" " required autocomplete="username">
                            <label>Username</label>
                        </div>
                        <div class="form-group">
                            <input name="password" type="password" placeholder=" " required autocomplete="current-password">
                            <label>Password</label>
                        </div>
                        <button type="submit">🚀 Login to Dashboard</button>
                    </form>
                    <div class="login-attempts">
                        🔒 Secure session management enabled
                    </div>
                    <div class="back-link">
                        <a href="/">← Back to Home</a>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        if (username === CONFIG.ADMIN_USERNAME && password === CONFIG.ADMIN_PASSWORD) {
            req.session.user = CONFIG.ADMIN_USERNAME;
            await logActivity('ADMIN_LOGIN_SUCCESS', `Admin logged in`, req.ip, req.get('User-Agent'));
            console.log('✅ Admin logged in successfully');
            return res.redirect('/admin');
        }
        
        await logActivity('ADMIN_LOGIN_FAILED', `Failed login attempt for: ${username}`, req.ip, req.get('User-Agent'));
        console.log('❌ Failed login attempt');
        res.send('<script>alert("Invalid credentials!");window.location="/admin/login";</script>');
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).send('<script>alert("Server error!");window.location="/admin/login";</script>');
    }
});

app.get('/admin/logout', async (req, res) => {
    try {
        await logActivity('ADMIN_LOGOUT', `Admin logged out`, req.ip, req.get('User-Agent'));
        req.session.destroy(() => {
            res.redirect('/admin/login');
        });
    } catch (error) {
        console.error('Logout error:', error);
        req.session.destroy(() => {
            res.redirect('/admin/login');
        });
    }
});

// --- ULTIMATE ADMIN DASHBOARD ---
app.get('/admin', requireLogin, async (req, res) => {
    try {
        const [licenses, banlist, activityLog, hwidRequests, settings, templates] = await Promise.all([
            getLicenses(),
            getBanlist(),
            getActivityLog(50),
            getHwidRequests(),
            getSettings(),
            getLicenseTemplates()
        ]);
        
        const totalLicenses = Object.keys(licenses).length;
        let activeLicenses = 0;
        let expiredLicenses = 0;
        let recentActivity = 0;
        
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        Object.values(licenses).forEach(license => {
            if (license.hwid) {
                if (isLicenseExpired(license)) {
                    expiredLicenses++;
                } else {
                    activeLicenses++;
                }
            }
            if (license.lastValidated && new Date(license.lastValidated) > oneDayAgo) {
                recentActivity++;
            }
        });
        
        // Generate various UI components (truncated for brevity)
        const licenseRows = Object.entries(licenses).map(([key, val]) => `
            <tr>
                <td class="license-key">
                    <div class="license-info">
                        <span class="key">${key}</span>
                        <small class="created">${val.createdAt ? formatTimeAgo(val.createdAt) : 'Unknown'}</small>
                    </div>
                </td>
                <td class="hwid">${val.hwid || '<span class="inactive">Not Activated</span>'}</td>
                <td>${val.expiry ? val.expiry.split('T')[0] : '<span class="never">Never</span>'}</td>
                <td>${val.activatedAt ? val.activatedAt.replace('T', ' ').substring(0, 19) : '<span class="inactive">-</span>'}</td>
                <td>${val.lastValidated ? formatTimeAgo(val.lastValidated) : '<span class="inactive">Never</span>'}</td>
                <td class="status ${isLicenseExpired(val) ? 'expired' : (val.hwid ? 'active' : 'inactive')}">
                    ${isLicenseExpired(val) ? '🔴 EXPIRED' : (val.hwid ? '🟢 ACTIVE' : '🟡 INACTIVE')}
                </td>
                <td class="actions">
                    <div class="action-buttons">
                        <button onclick="viewLicenseHistory('${key}')" class="btn btn-info" title="View History">📖</button>
                        <form style="display:inline;" method="post" action="/admin/reset-hwid">
                            <input type="hidden" name="license" value="${key}">
                            <button type="submit" class="btn btn-warning" title="Reset HWID">↻</button>
                        </form>
                        <form style="display:inline;" method="post" action="/admin/delete-license">
                            <input type="hidden" name="license" value="${key}">
                            <button type="submit" class="btn btn-danger" onclick="return confirm('Are you sure?')" title="Delete">🗑️</button>
                        </form>
                    </div>
                </td>
            </tr>
        `).join('');
        
        const activityRows = activityLog.slice(0, 20).map(entry => `
            <tr>
                <td>${entry.date ? formatTimeAgo(entry.date) : 'Unknown'}</td>
                <td><span class="activity-action">${entry.action}</span></td>
                <td class="activity-details">${entry.details || '-'}</td>
                <td><span class="ip-address">${entry.ip || 'Unknown'}</span></td>
            </tr>
        `).join('');
        
        const hwidRequestRows = hwidRequests.map(req => `
            <tr>
                <td class="license-key">${req.license}</td>
                <td class="hwid">${req.hwid}</td>
                <td class="request-reason">${req.reason || 'No reason provided'}</td>
                <td>${req.timestamp ? formatTimeAgo(req.timestamp.toDate ? req.timestamp.toDate() : req.timestamp) : 'Unknown'}</td>
                <td><span class="ip-address">${req.requestIP || 'Unknown'}</span></td>
                <td class="actions">
                    <form style="display:inline;" method="post" action="/admin/approve-hwid-reset">
                        <input type="hidden" name="requestId" value="${req.id}">
                        <input type="hidden" name="license" value="${req.license}">
                        <button type="submit" class="btn btn-success" title="Approve">✅</button>
                    </form>
                    <form style="display:inline;" method="post" action="/admin/deny-hwid-reset">
                        <input type="hidden" name="requestId" value="${req.id}">
                        <button type="submit" class="btn btn-danger" title="Deny">❌</button>
                    </form>
                </td>
            </tr>
        `).join('');
        
        const banRows = banlist.map(hwid => `
            <tr>
                <td class="hwid">${hwid}</td>
                <td>${new Date().toISOString().split('T')[0]}</td>
                <td class="actions">
                    <form style="display:inline;" method="post" action="/admin/unban-hwid">
                        <input type="hidden" name="hwid" value="${hwid}">
                        <button type="submit" class="btn btn-success" title="Unban">🔓 Unban</button>
                    </form>
                </td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>PC Optimizer Pro - Ultimate Admin Dashboard</title>
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <style>
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body { 
                        background: linear-gradient(135deg, #1a1d23 0%, #23272e 100%);
                        color: #00aaee; 
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        min-height: 100vh;
                        padding: 20px;
                        position: relative;
                    }
                    .container { 
                        max-width: 1600px; 
                        margin: 0 auto; 
                        background: rgba(35, 39, 46, 0.95);
                        border-radius: 25px; 
                        box-shadow: 0 15px 50px rgba(0, 170, 238, 0.3);
                        padding: 30px;
                        border: 2px solid rgba(0, 170, 238, 0.4);
                        backdrop-filter: blur(15px);
                    }
                    .header { 
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 40px;
                        padding-bottom: 25px;
                        border-bottom: 3px solid rgba(0, 170, 238, 0.3);
                        position: relative;
                    }
                    .header:after {
                        content: '';
                        position: absolute;
                        bottom: -3px;
                        left: 0;
                        width: 200px;
                        height: 3px;
                        background: linear-gradient(90deg, #00aaee, #0099cc, #00d4ff);
                        animation: slide 3s ease-in-out infinite alternate;
                    }
                    @keyframes slide { 0% { width: 200px; } 100% { width: 400px; } }
                    h1 { 
                        font-size: 2.8em;
                        background: linear-gradient(45deg, #00aaee, #0099cc, #00d4ff);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                        background-clip: text;
                        animation: textGlow 3s ease-in-out infinite alternate;
                    }
                    @keyframes textGlow { 0% { filter: drop-shadow(0 0 20px rgba(0, 170, 238, 0.5)); } 100% { filter: drop-shadow(0 0 30px rgba(0, 170, 238, 0.8)); } }
                    .header-actions {
                        display: flex;
                        gap: 15px;
                        align-items: center;
                    }
                    .logout-btn {
                        background: linear-gradient(45deg, #dc3545, #c82333);
                        color: white;
                        padding: 12px 25px;
                        border-radius: 10px;
                        text-decoration: none;
                        font-weight: bold;
                        transition: all 0.3s;
                        box-shadow: 0 4px 15px rgba(220, 53, 69, 0.3);
                    }
                    .logout-btn:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 6px 20px rgba(220, 53, 69, 0.4);
                    }
                    .live-indicator {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        background: rgba(40, 167, 69, 0.2);
                        padding: 8px 15px;
                        border-radius: 20px;
                        border: 1px solid rgba(40, 167, 69, 0.5);
                    }
                    .live-dot {
                        width: 10px;
                        height: 10px;
                        border-radius: 50%;
                        background: #28a745;
                        animation: pulse 2s infinite;
                    }
                    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(40, 167, 69, 0); } 100% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0); } }
                    .stats-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                        gap: 25px;
                        margin-bottom: 50px;
                    }
                    .stat-card {
                        background: linear-gradient(135deg, rgba(0, 170, 238, 0.1), rgba(0, 153, 204, 0.1));
                        padding: 30px;
                        border-radius: 20px;
                        text-align: center;
                        border: 2px solid rgba(0, 170, 238, 0.3);
                        transition: all 0.4s;
                        position: relative;
                        overflow: hidden;
                    }
                    .stat-card:before {
                        content: '';
                        position: absolute;
                        top: -50%;
                        left: -50%;
                        width: 200%;
                        height: 200%;
                        background: linear-gradient(45deg, transparent, rgba(0, 170, 238, 0.1), transparent);
                        transform: rotate(45deg);
                        transition: all 0.6s;
                        opacity: 0;
                    }
                    .stat-card:hover:before { opacity: 1; animation: shine 1.5s ease-in-out; }
                    @keyframes shine { 0% { transform: translateX(-100%) translateY(-100%) rotate(45deg); } 100% { transform: translateX(100%) translateY(100%) rotate(45deg); } }
                    .stat-card:hover {
                        transform: translateY(-10px) scale(1.02);
                        box-shadow: 0 15px 40px rgba(0, 170, 238, 0.4);
                        border-color: rgba(0, 170, 238, 0.6);
                    }
                    .stat-number {
                        font-size: 3em;
                        font-weight: bold;
                        margin-bottom: 10px;
                        background: linear-gradient(45deg, #00aaee, #0099cc, #00d4ff);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                        background-clip: text;
                        position: relative;
                        z-index: 2;
                    }
                    .stat-label {
                        font-size: 1.1em;
                        font-weight: 600;
                        color: #00aaee;
                        position: relative;
                        z-index: 2;
                    }
                    .stat-change {
                        font-size: 0.9em;
                        margin-top: 8px;
                        opacity: 0.8;
                        position: relative;
                        z-index: 2;
                    }
                    .section { 
                        margin-bottom: 50px;
                        background: rgba(26, 29, 35, 0.6);
                        padding: 35px;
                        border-radius: 20px;
                        border: 2px solid rgba(0, 170, 238, 0.2);
                        position: relative;
                        overflow: hidden;
                    }
                    .section:before {
                        content: '';
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        height: 4px;
                        background: linear-gradient(90deg, #00aaee, #0099cc, #00d4ff, #00aaee);
                        background-size: 200% 100%;
                        animation: gradientFlow 3s ease infinite;
                    }
                    @keyframes gradientFlow { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
                    .section h2 { 
                        margin-bottom: 25px;
                        color: #00aaee;
                        font-size: 1.8em;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        gap: 12px;
                    }
                    .section-icon {
                        font-size: 1.2em;
                        padding: 8px;
                        border-radius: 8px;
                        background: rgba(0, 170, 238, 0.2);
                    }
                    table { 
                        width: 100%; 
                        background: rgba(35, 39, 46, 0.9);
                        border-collapse: collapse; 
                        margin-top: 25px;
                        border-radius: 15px;
                        overflow: hidden;
                        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
                    }
                    th, td { 
                        border: 1px solid rgba(0, 170, 238, 0.2);
                        padding: 18px 15px; 
                        text-align: left;
                    }
                    th { 
                        background: linear-gradient(135deg, #00aaee, #0099cc);
                        color: white;
                        font-weight: bold;
                        text-transform: uppercase;
                        font-size: 0.9em;
                        letter-spacing: 1px;
                        position: relative;
                    }
                    th:after {
                        content: '';
                        position: absolute;
                        bottom: 0;
                        left: 0;
                        right: 0;
                        height: 2px;
                        background: rgba(255, 255, 255, 0.3);
                    }
                    tr:nth-child(even) { 
                        background: rgba(0, 170, 238, 0.05);
                    }
                    tr:hover { 
                        background: rgba(0, 170, 238, 0.15);
                        transform: scale(1.01);
                        transition: all 0.3s;
                    }
                    .license-key { 
                        font-family: 'Courier New', monospace;
                        font-weight: bold;
                    }
                    .license-info .key {
                        display: block;
                        font-size: 1.1em;
                        color: #00aaee;
                    }
                    .license-info .created {
                        color: #6c757d;
                        font-size: 0.8em;
                    }
                    .hwid { 
                        font-family: 'Courier New', monospace;
                        font-size: 0.9em;
                    }
                    .status {
                        font-weight: bold;
                        padding: 8px 12px;
                        border-radius: 8px;
                        text-align: center;
                        font-size: 0.9em;
                    }
                    .status.active { background: rgba(40, 167, 69, 0.2); color: #28a745; }
                    .status.inactive { background: rgba(108, 117, 125, 0.2); color: #6c757d; }
                    .status.expired { background: rgba(220, 53, 69, 0.2); color: #dc3545; }
                    .inactive, .never { color: #6c757d; font-style: italic; }
                    .btn {
                        padding: 8px 12px;
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: bold;
                        margin: 2px;
                        transition: all 0.3s;
                        font-size: 0.85em;
                        min-width: 35px;
                    }
                    .btn-danger { background: linear-gradient(45deg, #dc3545, #c82333); color: white; }
                    .btn-warning { background: linear-gradient(45deg, #ffc107, #e0a800); color: #212529; }
                    .btn-success { background: linear-gradient(45deg, #28a745, #1e7e34); color: white; }
                    .btn-primary { background: linear-gradient(45deg, #00aaee, #0099cc); color: white; }
                    .btn-info { background: linear-gradient(45deg, #17a2b8, #138496); color: white; }
                    .btn:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
                    }
                    .action-buttons {
                        display: flex;
                        gap: 5px;
                        flex-wrap: wrap;
                    }
                    .form-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 20px;
                        align-items: end;
                        margin-bottom: 25px;
                    }
                    input, select {
                        padding: 12px 15px;
                        background: rgba(26, 29, 35, 0.8);
                        color: #00aaee;
                        border: 2px solid rgba(0, 170, 238, 0.3);
                        border-radius: 8px;
                        outline: none;
                        transition: all 0.3s;
                        width: 100%;
                    }
                    input:focus, select:focus {
                        border-color: #00aaee;
                        box-shadow: 0 0 15px rgba(0, 170, 238, 0.3);
                        transform: translateY(-1px);
                    }
                    .scrollable {
                        max-height: 500px;
                        overflow-y: auto;
                        border-radius: 15px;
                        border: 2px solid rgba(0, 170, 238, 0.2);
                    }
                    .scrollable::-webkit-scrollbar { width: 8px; }
                    .scrollable::-webkit-scrollbar-track { background: rgba(26, 29, 35, 0.5); border-radius: 4px; }
                    .scrollable::-webkit-scrollbar-thumb { background: rgba(0, 170, 238, 0.5); border-radius: 4px; }
                    .scrollable::-webkit-scrollbar-thumb:hover { background: rgba(0, 170, 238, 0.7); }
                    .activity-action {
                        background: rgba(0, 170, 238, 0.2);
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 0.85em;
                        font-weight: bold;
                    }
                    .activity-details {
                        font-family: 'Courier New', monospace;
                        font-size: 0.9em;
                        color: #6c757d;
                    }
                    .ip-address {
                        font-family: 'Courier New', monospace;
                        background: rgba(0, 0, 0, 0.2);
                        padding: 2px 6px;
                        border-radius: 4px;
                        font-size: 0.8em;
                    }
                    .request-reason {
                        max-width: 200px;
                        word-wrap: break-word;
                        font-style: italic;
                        color: #6c757d;
                    }
                    .firebase-status {
                        background: linear-gradient(45deg, #28a745, #1e7e34);
                        color: white;
                        padding: 15px;
                        text-align: center;
                        margin-bottom: 30px;
                        border-radius: 12px;
                        font-weight: bold;
                        position: relative;
                        overflow: hidden;
                    }
                    .firebase-status:before {
                        content: '';
                        position: absolute;
                        top: -50%;
                        left: -50%;
                        width: 200%;
                        height: 200%;
                        background: linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent);
                        animation: scan 3s linear infinite;
                    }
                    @keyframes scan { 0% { transform: translateX(-100%) translateY(-100%); } 100% { transform: translateX(100%) translateY(100%); } }
                    .system-info {
                        text-align: center; 
                        margin-top: 50px; 
                        padding: 30px; 
                        background: rgba(0, 170, 238, 0.1); 
                        border-radius: 15px;
                        border: 2px solid rgba(0, 170, 238, 0.3);
                    }
                    .quick-actions {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                        gap: 20px;
                        margin-bottom: 30px;
                    }
                    .quick-action-card {
                        background: rgba(0, 170, 238, 0.1);
                        padding: 25px;
                        border-radius: 15px;
                        border: 2px solid rgba(0, 170, 238, 0.3);
                        text-align: center;
                        transition: all 0.3s;
                    }
                    .quick-action-card:hover {
                        transform: translateY(-5px);
                        box-shadow: 0 10px 30px rgba(0, 170, 238, 0.3);
                    }
                    .modal {
                        display: none;
                        position: fixed;
                        z-index: 1000;
                        left: 0;
                        top: 0;
                        width: 100%;
                        height: 100%;
                        background-color: rgba(0,0,0,0.8);
                        backdrop-filter: blur(5px);
                    }
                    .modal-content {
                        background: rgba(35, 39, 46, 0.95);
                        margin: 5% auto;
                        padding: 30px;
                        border-radius: 15px;
                        width: 80%;
                        max-width: 600px;
                        border: 2px solid rgba(0, 170, 238, 0.4);
                        box-shadow: 0 15px 50px rgba(0, 170, 238, 0.3);
                    }
                    .close {
                        color: #aaa;
                        float: right;
                        font-size: 28px;
                        font-weight: bold;
                        cursor: pointer;
                        transition: color 0.3s;
                    }
                    .close:hover { color: #00aaee; }
                    @media (max-width: 768px) {
                        .header { flex-direction: column; gap: 20px; }
                        .stats-grid { grid-template-columns: 1fr 1fr; }
                        .form-grid { grid-template-columns: 1fr; }
                        table { font-size: 0.9em; }
                        .action-buttons { justify-content: center; }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="firebase-status">
                        🔥 Firebase Connected - Real-time Data Management Active | Project: optimizer-ae60e
                    </div>
                    
                    <div class="header">
                        <h1>🚀 PC Optimizer Pro Ultimate</h1>
                        <div class="header-actions">
                            <div class="live-indicator">
                                <div class="live-dot"></div>
                                <span>Live</span>
                            </div>
                            <a href="/admin/logout" class="logout-btn">🚪 Logout</a>
                        </div>
                    </div>
                    
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-number">${totalLicenses}</div>
                            <div class="stat-label">Total Licenses</div>
                            <div class="stat-change">📈 All time</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">${activeLicenses}</div>
                            <div class="stat-label">Active Licenses</div>
                            <div class="stat-change">🟢 Currently active</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">${expiredLicenses}</div>
                            <div class="stat-label">Expired Licenses</div>
                            <div class="stat-change">🔴 Need renewal</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">${recentActivity}</div>
                            <div class="stat-label">Recent Activity</div>
                            <div class="stat-change">📊 Last 24h</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">${banlist.length}</div>
                            <div class="stat-label">Banned HWIDs</div>
                            <div class="stat-change">🚫 Security active</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">${hwidRequests.length}</div>
                            <div class="stat-label">Pending Requests</div>
                            <div class="stat-change">⏳ Need attention</div>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h2><span class="section-icon">🎫</span>License Generation</h2>
                        <div class="quick-actions">
                            <div class="quick-action-card">
                                <h3>🚀 Quick Generate</h3>
                                <form method="post" action="/admin/generate-license">
                                    <div class="form-grid">
                                        <input name="license" placeholder="Custom Key (optional)">
                                        <input name="expiry" type="date">
                                        <button type="submit" class="btn btn-primary">Generate</button>
                                    </div>
                                </form>
                            </div>
                            <div class="quick-action-card">
                                <h3>📦 Bulk Generate</h3>
                                <form method="post" action="/admin/bulk-generate">
                                    <div class="form-grid">
                                        <input name="count" type="number" placeholder="Quantity" min="1" max="100">
                                        <input name="prefix" placeholder="Prefix (optional)">
                                        <button type="submit" class="btn btn-primary">Bulk Create</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h2><span class="section-icon">📋</span>License Management (${totalLicenses} Total)</h2>
                        <div class="scrollable">
                            <table>
                                <tr>
                                    <th>License Key</th>
                                    <th>Hardware ID</th>
                                    <th>Expiry Date</th>
                                    <th>Activated At</th>
                                    <th>Last Seen</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                                ${licenseRows || '<tr><td colspan="7" style="text-align:center;padding:40px;color:#6c757d;">No licenses found. Generate your first license above.</td></tr>'}
                            </table>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h2><span class="section-icon">📊</span>Recent Activity</h2>
                        <div class="scrollable">
                            <table>
                                <tr>
                                    <th>Time</th>
                                    <th>Action</th>
                                    <th>Details</th>
                                    <th>IP Address</th>
                                </tr>
                                ${activityRows || '<tr><td colspan="4" style="text-align:center;padding:40px;color:#6c757d;">No recent activity.</td></tr>'}
                            </table>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h2><span class="section-icon">🔄</span>HWID Reset Requests (${hwidRequests.length} Pending)</h2>
                        <div class="scrollable">
                            <table>
                                <tr>
                                    <th>License</th>
                                    <th>Hardware ID</th>
                                    <th>Reason</th>
                                    <th>Requested</th>
                                    <th>IP Address</th>
                                    <th>Actions</th>
                                </tr>
                                ${hwidRequestRows || '<tr><td colspan="6" style="text-align:center;padding:40px;color:#6c757d;">No pending HWID reset requests.</td></tr>'}
                            </table>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h2><span class="section-icon">🚫</span>HWID Ban Management</h2>
                        <form method="post" action="/admin/ban-hwid">
                            <div class="form-grid">
                                <input name="hwid" placeholder="Hardware ID to ban" required>
                                <input name="reason" placeholder="Ban reason (optional)">
                                <button type="submit" class="btn btn-danger">🚫 Ban HWID</button>
                            </div>
                        </form>
                        <div class="scrollable">
                            <table>
                                <tr>
                                    <th>Banned Hardware ID</th>
                                    <th>Banned Date</th>
                                    <th>Actions</th>
                                </tr>
                                ${banRows || '<tr><td colspan="3" style="text-align:center;padding:40px;color:#6c757d;">No banned HWIDs.</td></tr>'}
                            </table>
                        </div>
                    </div>
                    
                    <div class="system-info">
                        <h3>🔧 System Information</h3>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-top: 20px;">
                            <div>
                                <strong>Server Status:</strong><br>
                                <span style="color: #28a745;">●</span> Online & Healthy
                            </div>
                            <div>
                                <strong>Firebase Project:</strong><br>
                                optimizer-ae60e
                            </div>
                            <div>
                                <strong>Environment:</strong><br>
                                ${process.env.NODE_ENV || 'development'}
                            </div>
                            <div>
                                <strong>Port:</strong><br>
                                ${CONFIG.PORT}
                            </div>
                            <div>
                                <strong>Uptime:</strong><br>
                                ${Math.floor(process.uptime() / 60)}m ${Math.floor(process.uptime() % 60)}s
                            </div>
                            <div>
                                <strong>Memory Usage:</strong><br>
                                ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- License History Modal -->
                <div id="historyModal" class="modal">
                    <div class="modal-content">
                        <span class="close">&times;</span>
                        <h2>📖 License History</h2>
                        <div id="historyContent"></div>
                    </div>
                </div>
                
                <script>
                    function viewLicenseHistory(licenseKey) {
                        // This would fetch and display license history
                        document.getElementById('historyModal').style.display = 'block';
                        document.getElementById('historyContent').innerHTML = 
                            '<p>Loading history for license: <strong>' + licenseKey + '</strong></p>' +
                            '<p>Feature coming soon - will show detailed license activity history.</p>';
                    }
                    
                    document.querySelector('.close').onclick = function() {
                        document.getElementById('historyModal').style.display = 'none';
                    }
                    
                    window.onclick = function(event) {
                        if (event.target == document.getElementById('historyModal')) {
                            document.getElementById('historyModal').style.display = 'none';
                        }
                    }
                    
                    // Auto-refresh page every 30 seconds
                    setTimeout(function() {
                        window.location.reload();
                    }, 30000);
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).send(`
            <div style="text-align:center;padding:50px;color:red;background:#1a1d23;min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;">
                <h2>🚨 Dashboard Error</h2>
                <p>Error: ${error.message}</p>
                <a href="/admin/login" style="color:#00aaee;margin-top:20px;">← Back to Login</a>
            </div>
        `);
    }
});

// --- NEW ADMIN ACTIONS ---
app.post('/admin/generate-license', requireLogin, async (req, res) => {
    try {
        let license = req.body.license || generateSecureLicenseKey();
        
        const existingLicense = await getLicense(license);
        if (existingLicense) {
            return res.send('<script>alert("License already exists!");window.location="/admin";</script>');
        }
        
        let expiry = req.body.expiry ? new Date(req.body.expiry).toISOString() : null;
        const licenseData = { 
            hwid: '', 
            activatedAt: '', 
            expiry, 
            history: [],
            createdAt: new Date().toISOString(),
            createdBy: req.session.user
        };
        
        await saveLicense(license, licenseData);
        await logActivity('LICENSE_GENERATED', `License: ${license} Expiry: ${expiry || 'Never'}`, req.ip, req.get('User-Agent'));
        console.log(`✅ Generated license: ${license}`);
        res.redirect('/admin');
    } catch (error) {
        console.error('Generate license error:', error);
        res.send('<script>alert("Error generating license!");window.location="/admin";</script>');
    }
});

app.post('/admin/bulk-generate', requireLogin, async (req, res) => {
    try {
        const count = parseInt(req.body.count) || 1;
        const prefix = req.body.prefix || 'LIC';
        
        if (count > 100) {
            return res.send('<script>alert("Maximum 100 licenses at once!");window.location="/admin";</script>');
        }
        
        const licenses = [];
        for (let i = 0; i < count; i++) {
            const license = generateSecureLicenseKey(prefix);
            const licenseData = {
                hwid: '',
                activatedAt: '',
                expiry: null,
                history: [],
                createdAt: new Date().toISOString(),
                createdBy: req.session.user,
                batchId: Date.now()
            };
            
            await saveLicense(license, licenseData);
            licenses.push(license);
        }
        
        await logActivity('BULK_GENERATE', `Generated ${count} licenses with prefix: ${prefix}`, req.ip, req.get('User-Agent'));
        console.log(`✅ Bulk generated ${count} licenses`);
        res.redirect('/admin');
    } catch (error) {
        console.error('Bulk generate error:', error);
        res.send('<script>alert("Error generating licenses!");window.location="/admin";</script>');
    }
});

app.post('/admin/delete-license', requireLogin, async (req, res) => {
    try {
        const { license } = req.body;
        await deleteLicense(license);
        await logActivity('LICENSE_DELETED', `License: ${license}`, req.ip, req.get('User-Agent'));
        console.log(`🗑️ Deleted license: ${license}`);
        res.redirect('/admin');
    } catch (error) {
        console.error('Delete license error:', error);
        res.send('<script>alert("Error deleting license!");window.location="/admin";</script>');
    }
});

app.post('/admin/reset-hwid', requireLogin, async (req, res) => {
    try {
        const { license } = req.body;
        const lic = await getLicense(license);
        if (lic) {
            const updatedLic = {
                ...lic,
                hwid: '',
                activatedAt: '',
                history: [...(lic.history || []), {
                    action: "HWID_RESET_BY_ADMIN",
                    date: new Date().toISOString(),
                    admin: req.session.user
                }]
            };
            await saveLicense(license, updatedLic);
            await logActivity('HWID_RESET', `License: ${license}`, req.ip, req.get('User-Agent'));
            console.log(`↻ Reset HWID for license: ${license}`);
        }
        res.redirect('/admin');
    } catch (error) {
        console.error('Reset HWID error:', error);
        res.send('<script>alert("Error resetting HWID!");window.location="/admin";</script>');
    }
});

app.post('/admin/approve-hwid-reset', requireLogin, async (req, res) => {
    try {
        const { requestId, license } = req.body;
        const lic = await getLicense(license);
        if (lic) {
            const updatedLic = {
                ...lic,
                hwid: '',
                activatedAt: '',
                history: [...(lic.history || []), {
                    action: "HWID_RESET_APPROVED",
                    date: new Date().toISOString(),
                    admin: req.session.user
                }]
            };
            await saveLicense(license, updatedLic);
            await logActivity('HWID_RESET_APPROVED', `License: ${license} RequestID: ${requestId}`, req.ip, req.get('User-Agent'));
        }
        await deleteHwidRequest(requestId);
        res.redirect('/admin');
    } catch (error) {
        console.error('Approve HWID reset error:', error);
        res.send('<script>alert("Error approving request!");window.location="/admin";</script>');
    }
});

app.post('/admin/deny-hwid-reset', requireLogin, async (req, res) => {
    try {
        const { requestId } = req.body;
        await logActivity('HWID_RESET_DENIED', `RequestID: ${requestId}`, req.ip, req.get('User-Agent'));
        await deleteHwidRequest(requestId);
        res.redirect('/admin');
    } catch (error) {
        console.error('Deny HWID reset error:', error);
        res.send('<script>alert("Error denying request!");window.location="/admin";</script>');
    }
});

app.post('/admin/ban-hwid', requireLogin, async (req, res) => {
    try {
        const { hwid, reason } = req.body;
        if (hwid && hwid.trim()) {
            const banlist = await getBanlist();
            if (!banlist.includes(hwid.trim())) {
                banlist.push(hwid.trim());
                await saveBanlist(banlist);
                await logActivity('HWID_BANNED', `HWID: ${hwid} Reason: ${reason || 'No reason'}`, req.ip, req.get('User-Agent'));
                console.log(`🚫 Banned HWID: ${hwid}`);
            }
        }
        res.redirect('/admin');
    } catch (error) {
        console.error('Ban HWID error:', error);
        res.send('<script>alert("Error banning HWID!");window.location="/admin";</script>');
    }
});

app.post('/admin/unban-hwid', requireLogin, async (req, res) => {
    try {
        const { hwid } = req.body;
        const banlist = await getBanlist();
        const newBanlist = banlist.filter(h => h !== hwid);
        await saveBanlist(newBanlist);
        await logActivity('HWID_UNBANNED', `HWID: ${hwid}`, req.ip, req.get('User-Agent'));
        console.log(`✅ Unbanned HWID: ${hwid}`);
        res.redirect('/admin');
    } catch (error) {
        console.error('Unban HWID error:', error);
        res.send('<script>alert("Error unbanning HWID!");window.location="/admin";</script>');
    }
});

// --- ERROR HANDLING ---
app.use((req, res) => {
    res.status(404).send(`
        <div style="text-align:center;padding:100px;background:#1a1d23;color:#00aaee;font-family:sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;">
            <h1 style="font-size:4em;margin-bottom:20px;">🔍 404</h1>
            <h2>Page Not Found</h2>
            <p style="margin:20px 0;">The page you're looking for doesn't exist.</p>
            <a href="/" style="color:#00aaee;background:rgba(0,170,238,0.2);padding:10px 20px;border-radius:8px;text-decoration:none;border:1px solid rgba(0,170,238,0.3);">← Back to Home</a>
        </div>
    `);
});

// --- SERVER STARTUP ---
const PORT = CONFIG.PORT;

app.listen(PORT, () => {
    console.log('\n🎉 ===== PC OPTIMIZER PRO ULTIMATE =====');
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`🔥 Firebase connected to project: optimizer-ae60e`);
    console.log(`🛡️ Security & monitoring active`);
    console.log(`📊 Real-time analytics enabled`);
    console.log(`👤 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`🔑 Login with username: ${CONFIG.ADMIN_USERNAME}`);
    console.log('🚀 All systems operational!');
    console.log('==========================================\n');
});

module.exports = app;
