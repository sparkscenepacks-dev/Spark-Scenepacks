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
const COOKIE_SECRET = 'spark-scenepacks-admin-token';
app.use(cookieParser(COOKIE_SECRET));

// Admin Credentials
const ADMIN_USERS = [
    { username: 'admin', password: 'admin123' }
];

// Authentication Middleware
const isAuthenticated = (req, res, next) => {
    if (req.signedCookies && req.signedCookies.isAdmin === 'true') {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
};

// --- AUTH API ---

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = ADMIN_USERS.find(u =>
        u.username.toLowerCase() === (username || "").toLowerCase().trim() &&
        u.password === (password || "").trim()
    );

    if (user) {
        res.cookie('isAdmin', 'true', {
            signed: true,
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 24 * 60 * 60 * 1000
        });
        res.json({ message: 'Login successful', user: user.username });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('isAdmin');
    res.json({ message: 'Logged out successfully' });
});

// --- SCENEPACKS API (SUPABASE) ---

// List all scenepacks
app.get(['/api/scenepacks', '/api/scenepacks/'], async (req, res) => {
    // Prevent caching so deletions show up immediately
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

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
                // Fallback to sc_ fields in download_links if top-level columns are missing
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

// Add / update a scenepack (thumbnail URL already resolved by browser-side Supabase upload)
app.post('/api/scenepacks', isAuthenticated, express.json({ limit: '2mb' }), async (req, res) => {
    try {
        const scenepackData = req.body;
        console.log('Processing scenepack save request for ID:', scenepackData.id);

        // Attach attribution to download links as a fallback for missing columns
        const linksWithAttribution = (scenepackData.downloadLinks || []).map(link => ({
            ...link,
            sc_creator: scenepackData.creator,
            sc_uploader: scenepackData.uploader
        }));

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
                download_links: linksWithAttribution
            }])
            .select();

        if (error) throw error;
        res.json({ message: 'Scenepack saved successfully', data });
    } catch (err) {
        console.error('Supabase Save Error:', err);
        res.status(500).json({
            error: 'Failed to save to Supabase: ' + (err.message || err.details || 'Unknown Error')
        });
    }
});

// Increment download count
app.post('/api/scenepacks/:id/download', async (req, res) => {
    try {
        const { id } = req.params;

        // Fetch current count
        const { data: current, error: getError } = await supabase
            .from('scenepacks')
            .select('downloads')
            .eq('id', id)
            .single();

        if (getError) throw getError;

        // Atomic increment (using a raw field update isn't standard in JS client without RPC, so we do this)
        const newCount = (current?.downloads || 0) + 1;

        const { error: updateError } = await supabase
            .from('scenepacks')
            .update({ downloads: newCount })
            .eq('id', id);

        if (updateError) throw updateError;

        res.json({ success: true, downloads: newCount });
    } catch (err) {
        console.error('Download Increment Error:', err);
        res.status(500).json({ error: 'Failed to increment downloads' });
    }
});

// Delete a scenepack
app.delete('/api/scenepacks/:id', isAuthenticated, async (req, res) => {
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

// --- ROUTES & STATIC ---

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.use(express.static(__dirname));

app.get('*', (req, res) => {
    if (req.url.startsWith('/api')) {
        return res.status(404).json({ error: 'API Endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'index.html'));
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
