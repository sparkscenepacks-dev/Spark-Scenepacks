const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const serverless = require('serverless-http');
const { createClient } = require('@supabase/supabase-js');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 5000;

// Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://leafankrwvhdscjstwkf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlYWZhbmtyd3ZoZHNjanN0d2tmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTA3MjksImV4cCI6MjA5MTgyNjcyOX0.WG2bo313fznBlptywKrPnJBHUluftz3S53TYKJnfS6g';
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

// Admin Credentials
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'sparkscenepacks';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'spark911';

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
    const { username, password } = req.body;
    
    const isValid = 
        (username || "").toLowerCase().trim() === ADMIN_USERNAME.toLowerCase() &&
        (password || "").trim() === ADMIN_PASSWORD;

    if (isValid) {
        res.cookie('isAdmin', 'true', {
            signed: true,
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 24 * 60 * 60 * 1000
        });
        res.json({ message: 'Login successful', user: ADMIN_USERNAME });    } else {
        res.status(401).json({ error: 'Invalid credentials' });
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
app.post(['/api/requests', '/api/requests/', '/requests', '/requests/'], async (req, res) => {
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

app.get(['/api/requests', '/api/requests/', '/requests', '/requests/'], isAuthenticated, async (req, res) => {
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


// --- ROUTES & STATIC ---

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.use(express.static(__dirname));

// Fallback for all other routes
app.use((req, res) => {
    const isApiRequest = req.path.startsWith('/api/') || req.path === '/api';
    if (isApiRequest) {
        return res.status(404).json({
            error: 'API Endpoint not found',
            path: req.path,
            method: req.method
        });
    }
    // If it's a GET request for a non-API route, serve index.html (but NOT for assets or files with extensions)
    if (req.method === 'GET' && !req.path.includes('.') && !req.path.startsWith('/assets/')) {
        return res.sendFile(path.join(__dirname, 'index.html'));
    }
    res.status(404).send('Not Found');
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
