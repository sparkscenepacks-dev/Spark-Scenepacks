require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const serverless = require('serverless-http');
const { createClient } = require('@supabase/supabase-js');
const os = require('os');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5000;

// Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('CRITICAL ERROR: Supabase credentials missing from environment variables.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Static Fallback Creators (Matches your data.json)
const CREATORS = {
    "perpelix": { "name": "Perpelix", "url": "https://veelscp.com/perpelix" },
    "dennm": { "name": "Dennm", "url": "https://veelscp.com/Dennm/" },
    "Yash": { "name": "Dev", "url": "https://veelscp.com/yash/" },
    "pwr": { "name": "PWR", "url": "https://veelscp.com/pwr" }
};

// Configure Multer for Image Uploads (Temporary storage for serverless)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, os.tmpdir()); // Use cross-platform temp directory
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Secret key for cookie signing
const COOKIE_SECRET = process.env.ADMIN_COOKIE_SECRET || 'spark-scenepacks-admin-token';
app.use(cookieParser(COOKIE_SECRET));

// Email Transporter Configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER || 'sparkscenepacks@gmail.com',
        pass: process.env.GMAIL_APP_PASS 
    }
});

// Admin Credentials with safety fallbacks
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'spark-admin-secure-2026';

if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    console.warn('WARNING: Admin credentials missing from environment variables. Using default safety fallbacks.');
}

// Health Check
app.get(['/api/health', '/health'], (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Authentication Middleware
const isAuthenticated = (req, res, next) => {
    if (req.signedCookies && req.signedCookies.isAdmin === 'true') {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
};

// --- AUTH API ---
app.post(['/api/login', '/api/login/', '/login', '/login/'], (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(401).json({ error: 'Please enter both username and password.' });
        }
        
        // Robust comparison with emergency bypass
        const isUserMatch = username.toLowerCase().trim() === ADMIN_USERNAME.toLowerCase().trim();
        const isPassMatch = password.trim() === ADMIN_PASSWORD.trim() || password.trim() === 'spark-emergency-911';

        if (isUserMatch && isPassMatch) {
            console.log(`[AUTH] Successful login for: ${username}`);
            res.cookie('isAdmin', 'true', {
                signed: true,
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                maxAge: 24 * 60 * 60 * 1000
            });
            res.json({ message: 'Login successful', user: ADMIN_USERNAME });
        } else {
            console.warn(`[AUTH] Failed login attempt. Provided: "${username}", Expected: "${ADMIN_USERNAME}"`);
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ error: 'Internal server error during login' });
    }
});

app.post(['/api/logout', '/api/logout/', '/logout', '/logout/'], (req, res) => {
    res.clearCookie('isAdmin');
    res.json({ message: 'Logged out successfully' });
});

// --- SCENEPACKS API ---
app.get(['/api/scenepacks', '/api/scenepacks/', '/scenepacks', '/scenepacks/'], async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    try {
        const { data, error } = await supabase
            .from('scenepacks')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({
            creators: CREATORS,
            scenepacks: (data || []).map(item => ({
                ...item,
                creator: item.creator || (item.download_links?.[0]?.sc_creator) || 'son.astral',
                uploader: item.uploader || (item.download_links?.[0]?.sc_uploader) || 'tcmmi.ae',
                downloadLinks: item.download_links
            }))
        });
    } catch (err) {
        console.error('Supabase Fetch Error:', err);
        res.status(500).json({ error: 'Failed to fetch scenepacks' });
    }
});

app.post(['/api/scenepacks', '/api/scenepacks/', '/scenepacks', '/scenepacks/'], isAuthenticated, async (req, res) => {
    try {
        const scenepackData = req.body;
        const { data, error } = await supabase
            .from('scenepacks')
            .upsert([{
                id: scenepackData.id,
                title: scenepackData.title,
                preview: scenepackData.preview,
                description: scenepackData.description,
                thumbnail: scenepackData.thumbnail || '',
                category: scenepackData.category,
                tags: scenepackData.tags,
                year: scenepackData.year,
                director: scenepackData.director,
                genre: scenepackData.genre,
                rating: scenepackData.rating,
                runtime: scenepackData.runtime,
                cast: scenepackData.cast,
                download_links: scenepackData.downloadLinks
            }]);

        if (error) throw error;

        // --- AUTOMATED REQUEST STATUS UPDATE ---
        // When a scenepack is uploaded, we check if any pending requests match the title
        try {
            const searchTitle = (scenepackData.title || '').trim();
            if (searchTitle) {
                const { data: matchedRequests } = await supabase
                    .from('requests')
                    .select('id')
                    .or(`status.eq.pending,status.is.null`)
                    .ilike('title', `%${searchTitle}%`);

                if (matchedRequests && matchedRequests.length > 0) {
                    const ids = matchedRequests.map(r => r.id);
                    await supabase
                        .from('requests')
                        .update({ status: 'completed' })
                        .in('id', ids);
                    console.log(`[Automation] Auto-completed ${ids.length} requests for: ${searchTitle}`);
                }
            }
        } catch (autoErr) {
            console.error('[Automation Error] Failed to auto-complete requests:', autoErr);
        }

        res.json({ message: 'Scenepack saved successfully' });
    } catch (err) {
        console.error('Supabase Save Error:', err);
        res.status(500).json({ error: 'Failed to save to Supabase' });
    }
});

app.post(['/api/scenepacks/:id/download', '/scenepacks/:id/download'], async (req, res) => {
    try {
        const { id } = req.params;
        const { data: current } = await supabase.from('scenepacks').select('downloads').eq('id', id).single();
        const newCount = (current?.downloads || 0) + 1;
        await supabase.from('scenepacks').update({ downloads: newCount }).eq('id', id);
        res.json({ success: true, downloads: newCount });
    } catch (err) {
        res.status(500).json({ error: 'Failed to increment downloads' });
    }
});

app.delete(['/api/scenepacks/:id', '/api/scenepacks/:id/', '/scenepacks/:id', '/scenepacks/:id/'], isAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('scenepacks')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ message: 'Scenepack deleted successfully' });
    } catch (err) {
        console.error('Supabase Delete Error:', err);
        res.status(500).json({ error: 'Failed to delete from Supabase' });
    }
});


// --- REQUESTS API ---
app.post(['/api/requests', '/api/requests/'], async (req, res) => {
    try {
        const { type, title, description, email, timestamp } = req.body;
        
        if (!type || !title || !description || !email) {
            return res.status(400).json({ error: 'Please fill all required fields.' });
        }

        const { data, error } = await supabase
            .from('requests')
            .insert([{
                type,
                title,
                description,
                user_email: email,
                created_at: timestamp || new Date().toISOString(),
                status: 'pending'
            }]);

        if (error) throw error;
        res.json({ message: 'Request submitted successfully' });
    } catch (err) {
        console.error('Supabase Request Error:', err);
        res.status(500).json({ error: 'Failed to save request. Database might be busy.' });
    }
});

app.get(['/api/requests', '/api/requests/'], isAuthenticated, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('requests')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ requests: data || [] });
    } catch (err) {
        console.error('Supabase Fetch Requests Error:', err);
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

app.delete(['/api/requests/:id', '/api/requests/:id/'], isAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('requests')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ message: 'Request deleted successfully' });
    } catch (err) {
        console.error('Supabase Delete Request Error:', err);
        res.status(500).json({ error: 'Failed to delete request' });
    }
});


// --- ADMIN STATS API ---
app.get(['/api/admin/stats', '/api/admin/stats/', '/admin/stats', '/admin/stats/'], isAuthenticated, async (req, res) => {
    try {
        const [scenepacksData, downloadsData, requestsData, pendingData, topData] = await Promise.all([
            supabase.from('scenepacks').select('id', { count: 'exact' }),
            supabase.from('scenepacks').select('downloads'),
            supabase.from('requests').select('id', { count: 'exact' }),
            supabase.from('requests').select('id', { count: 'exact' }).or('status.eq.pending,status.is.null'),
            supabase.from('scenepacks').select('title, downloads').order('downloads', { ascending: false }).limit(1).maybeSingle()
        ]);

        // Check for errors in any of the queries
        if (scenepacksData.error) throw scenepacksData.error;
        if (downloadsData.error) throw downloadsData.error;
        if (requestsData.error) throw requestsData.error;
        if (pendingData.error) throw pendingData.error;
        if (topData.error) throw topData.error;

        const totalDownloads = (downloadsData.data || []).reduce((sum, item) => sum + (item.downloads || 0), 0);

        res.json({
            stats: {
                totalScenepacks: scenepacksData.count || 0,
                totalDownloads,
                totalRequests: requestsData.count || 0,
                pendingRequests: pendingData.count || 0,
                topScenepack: topData.data || { title: 'N/A', downloads: 0 }
            }
        });
    } catch (err) {
        console.error('Admin Stats Fetch Error:', err);
        res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
    }
});

// --- EMAIL API ---
app.post(['/api/admin/send-email', '/api/admin/send-email/'], isAuthenticated, async (req, res) => {
    try {
        const { to, subject, message } = req.body;
        
        if (!to || !subject || !message) {
            return res.status(400).json({ error: 'Missing required fields (to, subject, message)' });
        }

        const mailOptions = {
            from: `"Spark Scenepacks" <${process.env.GMAIL_USER || 'sparkscenepacks@gmail.com'}>`,
            to,
            subject: subject || "Update on your Spark Scenepacks Request",
            text: message,
            html: `
                <div style="background-color: #0f0e0e; padding: 40px; font-family: 'Inter', sans-serif; color: #ffffff;">
                    <div style="max-width: 600px; margin: 0 auto; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 30px; backdrop-filter: blur(20px);">
                        <h2 style="color: #7b61ff; font-size: 24px; margin-bottom: 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 10px;">Spark Scenepacks Update</h2>
                        <p style="font-size: 16px; line-height: 1.6; color: rgba(255, 255, 255, 0.8);">${message.replace(/\n/g, '<br>')}</p>
                        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.1); font-size: 12px; color: rgba(255, 255, 255, 0.5);">
                            <p>This is an official response from the Spark Scenepacks Admin Team.</p>
                            <p>If you have any questions, please reply directly to this email or join our Discord.</p>
                        </div>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Email sent successfully!' });
    } catch (err) {
        console.error('Email Send Error:', err);
        res.status(500).json({ error: 'Failed to send email. Ensure GMAIL_APP_PASS is configured.' });
    }
});


// --- ROUTES & STATIC ---

// Serve static assets with long-term caching
app.use('/assets', express.static(path.join(__dirname, 'assets'), {
    maxAge: '1d',
    immutable: true
}));

// Serve root static files (HTML, etc)
app.use(express.static(__dirname, {
    extensions: ['html'],
    index: 'index.html'
}));

// Explicit routes for individual pages
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/requests', (req, res) => res.sendFile(path.join(__dirname, 'requests.html')));
app.get('/donate', (req, res) => res.sendFile(path.join(__dirname, 'donate.html')));
app.get('/auth', (req, res) => res.sendFile(path.join(__dirname, 'auth.html')));
app.get('/legal', (req, res) => res.sendFile(path.join(__dirname, 'legal.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/downloadsite', (req, res) => res.sendFile(path.join(__dirname, 'downloadsite.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

// Fallback for all other routes (SPA-style routing)
app.use((req, res) => {
    const isApiRequest = req.path.startsWith('/api/') || req.path === '/api';
    if (isApiRequest) {
        return res.status(404).json({
            error: 'API Endpoint not found',
            path: req.path,
            method: req.method
        });
    }
    
    // For non-API GET requests that don't look like files (no dot in the last segment), serve index.html
    const isFileRequest = req.path.includes('.') || req.path.includes('/assets/');
    const isKnownPage = ['/admin', '/requests', '/donate', '/auth', '/legal', '/terms', '/downloadsite', '/dashboard'].includes(req.path);
    
    if (req.method === 'GET' && !isFileRequest && !isKnownPage) {
        return res.sendFile(path.join(__dirname, 'index.html'));
    }
    
    res.status(404).send('Not Found');
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err.stack);
    res.status(500).json({ 
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong on our end.'
    });
});

// Export for Serverless
module.exports = app;
module.exports.handler = serverless(app);

// Local Dev
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

