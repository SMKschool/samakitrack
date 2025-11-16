// api/rate-limit.js - Rate limiting middleware
export class RateLimiter {
    constructor(maxRequests = 30, windowMs = 60000) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = new Map();
    }

    check(identifier) {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        
        // Clean old requests
        if (this.requests.has(identifier)) {
            const timestamps = this.requests.get(identifier).filter(t => t > windowStart);
            this.requests.set(identifier, timestamps);
        }
        
        // Check limit
        const requests = this.requests.get(identifier) || [];
        if (requests.length >= this.maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                resetAt: Math.min(...requests) + this.windowMs
            };
        }
        
        // Add new request
        requests.push(now);
        this.requests.set(identifier, requests);
        
        return {
            allowed: true,
            remaining: this.maxRequests - requests.length,
            resetAt: now + this.windowMs
        };
    }

    reset(identifier) {
        this.requests.delete(identifier);
    }

    cleanup() {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        
        for (const [identifier, timestamps] of this.requests.entries()) {
            const validTimestamps = timestamps.filter(t => t > windowStart);
            if (validTimestamps.length === 0) {
                this.requests.delete(identifier);
            } else {
                this.requests.set(identifier, validTimestamps);
            }
        }
    }
}

// Export singleton instance
export const rateLimiter = new RateLimiter(30, 60000);

// Cleanup every 5 minutes
setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);

export default function handler(req, res) {
    const identifier = req.headers['x-forwarded-for']?.split(',')[0] || 
                      req.headers['x-real-ip'] || 
                      'unknown';
    
    const result = rateLimiter.check(identifier);
    
    res.setHeader('X-RateLimit-Limit', rateLimiter.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetAt);
    
    if (!result.allowed) {
        return res.status(429).json({
            error: 'សូមរង់ចាំបន្តិច ប្រើប្រាស់ញឹកញាប់ពេក',
            retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000)
        });
    }
    
    res.status(200).json({ ok: true });
}