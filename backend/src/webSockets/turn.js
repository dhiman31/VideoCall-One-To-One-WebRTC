const https = require('https')

const CF_APP_ID     = process.env.CF_APP_ID
const CF_APP_SECRET = process.env.CF_APP_SECRET

function getTurnCredentials() {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ ttl: 86400 })

        const options = {
            hostname: 'rtc.live.cloudflare.com',
            path: `/v1/turn/keys/${CF_APP_ID}/credentials/generate-ice-servers`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CF_APP_SECRET}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }

        const req = https.request(options, (res) => {
            let data = ''
            console.log("Cloudflare HTTP status:", res.statusCode)
            res.on('data', chunk => data += chunk)
            res.on('end', () => {
                console.log("Cloudflare raw response:", data)
                try {
                    const json = JSON.parse(data)
                    if (json.iceServers) {
                        // port 53 filter karo — browsers block karte hain
                        const filtered = json.iceServers.map(server => ({
                            ...server,
                            urls: Array.isArray(server.urls)
                                ? server.urls.filter(u => !u.includes(':53'))
                                : server.urls
                        }))
                        resolve(filtered)
                    } else {
                        reject(new Error("No iceServers in response: " + data))
                    }
                } catch (e) {
                    reject(new Error("Parse error: " + data))
                }
            })
        })

        req.on('error', (e) => {
            console.error("HTTPS request error:", e.message)
            reject(e)
        })

        req.write(body)
        req.end()
    })
}

module.exports = { getTurnCredentials }