const http = require('http')
const initiateWebSocket = require('./webSockets/webSocket')
const { getTurnCredentials } = require('./webSockets/turn')

const PORT = process.env.PORT || 3000

const httpServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
    }

    if (req.method === 'GET' && req.url === '/turn-credentials') {
        try {
            const iceServers = await getTurnCredentials()
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ iceServers }))
        } catch (e) {
            console.error('TURN fetch failed:', e.message)
            res.writeHead(500)
            res.end(JSON.stringify({ error: e.message }))
        }
        return
    }

    res.writeHead(404)
    res.end()
})

httpServer.listen(PORT, () => {
    console.log("HTTP server started on PORT", PORT)
    initiateWebSocket(httpServer)
})