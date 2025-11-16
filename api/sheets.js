// api/sheets.js - Optimized Google Sheets API with caching
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

// Server-side cache with better memory management
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;

// Rate limiting
const rateLimits = new Map();
const RATE_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 30;

// Compression helper
function shouldCompress(data) {
    const dataStr = JSON.stringify(data);
    return dataStr.length > 1000; // Compress if > 1KB
}

// Cache helpers
function getCacheKey(sheet, action) {
    return action ? `${action}` : `sheet:${sheet}`;
}

function getCache(key) {
    const item = cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > CACHE_TTL) {
        cache.delete(key);
        return null;
    }
    
    return item.data;
}

function setCache(key, data) {
    // Implement LRU-like behavior
    if (cache.size >= MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
}

// Clean expired cache periodically
function cleanCache() {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            cache.delete(key);
        }
    }
}

setInterval(cleanCache, 2 * 60 * 1000); // Clean every 2 minutes

// Rate limiting
function checkRateLimit(ip) {
    const now = Date.now();
    const userRequests = rateLimits.get(ip) || [];
    
    // Remove old requests
    const validRequests = userRequests.filter(t => now - t < RATE_WINDOW);
    
    if (validRequests.length >= MAX_REQUESTS) {
        return false;
    }
    
    validRequests.push(now);
    rateLimits.set(ip, validRequests);
    
    // Cleanup old entries
    if (rateLimits.size > 1000) {
        const oldestIp = rateLimits.keys().next().value;
        rateLimits.delete(oldestIp);
    }
    
    return true;
}

// Fetch from Google Sheets
async function fetchFromGoogleSheets(endpoint) {
    const response = await fetch(endpoint, {
        headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate'
        }
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Google Sheets API error: ${response.status} - ${error}`);
    }
    
    return await response.json();
}

export default async function handler(req, res) {
    // CORS headers
    const origin = req.headers.origin;
    const allowedOrigins = [
        'https://samakischool.app',
        'https://www.samakischool.app',
        'http://localhost:3000',
        'http://localhost:5173'
    ];
    
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get IP for rate limiting
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
               req.headers['x-real-ip'] || 
               req.socket.remoteAddress || 
               'unknown';

    // Check rate limit
    if (!checkRateLimit(ip)) {
        res.setHeader('Retry-After', Math.ceil(RATE_WINDOW / 1000));
        return res.status(429).json({ 
            error: 'សូមរង់ចាំបន្តិច - ប្រើប្រាស់ញឹកញាប់ពេក',
            retryAfter: Math.ceil(RATE_WINDOW / 1000)
        });
    }

    const { sheet, action } = req.query;

    try {
        // Validate environment variables
        if (!API_KEY || !SPREADSHEET_ID) {
            console.error('Missing environment variables');
            return res.status(500).json({ 
                error: 'Server configuration error' 
            });
        }

        // Handle sheet names list
        if (action === 'list') {
            const cacheKey = getCacheKey(null, 'list');
            let sheets = getCache(cacheKey);
            
            if (!sheets) {
                console.log('📡 Fetching sheet names from Google Sheets');
                const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?key=${API_KEY}&fields=sheets.properties.title`;
                const data = await fetchFromGoogleSheets(url);
                sheets = data.sheets.map(s => s.properties.title);
                setCache(cacheKey, sheets);
            } else {
                console.log('✅ Cache HIT: sheet names');
            }
            
            res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
            res.setHeader('X-Cache', sheets === getCache(cacheKey) ? 'HIT' : 'MISS');
            
            return res.status(200).json({ sheets });
        }

        // Handle specific sheet data
        if (!sheet) {
            return res.status(400).json({ 
                error: 'ត្រូវការឈ្មោះសន្លឹក (sheet name required)' 
            });
        }

        const cacheKey = getCacheKey(sheet);
        let data = getCache(cacheKey);
        
        if (!data) {
            console.log(`📡 Fetching sheet: ${sheet}`);
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheet)}?key=${API_KEY}`;
            const result = await fetchFromGoogleSheets(url);
            data = result.values || [];
            setCache(cacheKey, data);
        } else {
            console.log(`✅ Cache HIT: ${sheet}`);
        }
        
        // Set cache headers
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
        res.setHeader('X-Cache', data === getCache(cacheKey) ? 'HIT' : 'MISS');
        res.setHeader('X-Cache-TTL', CACHE_TTL);
        
        // Compress if needed
        if (shouldCompress(data)) {
            res.setHeader('Content-Encoding', 'gzip');
        }
        
        return res.status(200).json({ 
            values: data,
            range: sheet,
            cached: true
        });

    } catch (error) {
        console.error('❌ API Error:', error.message);
        
        // Provide helpful error messages
        if (error.message.includes('404')) {
            return res.status(404).json({ 
                error: 'រកមិនឃើញសន្លឹកនេះ',
                details: 'Sheet not found'
            });
        }
        
        if (error.message.includes('403') || error.message.includes('401')) {
            return res.status(403).json({ 
                error: 'មិនមានសិទ្ធិចូលប្រើ',
                details: 'Permission denied or invalid API key'
            });
        }
        
        if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
            return res.status(503).json({ 
                error: 'មិនអាចភ្ជាប់ទៅ Google Sheets',
                details: 'Network error'
            });
        }
        
        return res.status(500).json({ 
            error: 'មានបញ្ហាក្នុងការទាញយកទិន្នន័យ',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
}

// Memory usage monitoring (development only)
if (process.env.NODE_ENV === 'development') {
    setInterval(() => {
        const used = process.memoryUsage();
        console.log('📊 Memory:', {
            rss: `${Math.round(used.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,
            cacheSize: cache.size,
            rateLimitSize: rateLimits.size
        });
    }, 5 * 60 * 1000);
}