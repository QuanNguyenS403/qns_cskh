/**
 * Sliding Window Rate Limiter
 */
export function createRateLimiter({ windowMs = 60000, max = 30, message = 'Quá nhiều yêu cầu, vui lòng thử lại sau.' }) {
  const hits = new Map()

  return function rateLimiterMiddleware(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
    const now = Date.now()

    let record = hits.get(ip)
    if (!record) {
      record = { timestamps: [] }
      hits.set(ip, record)
    }

    // Lọc các timestamp nằm ngoài cửa sổ windowMs
    record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs)

    if (record.timestamps.length >= max) {
      const oldestHit = record.timestamps[0]
      const retryAfter = Math.ceil((windowMs - (now - oldestHit)) / 1000)
      res.setHeader('Retry-After', retryAfter)
      return res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds: retryAfter,
      })
    }

    record.timestamps.push(now)
    next()
  }
}
