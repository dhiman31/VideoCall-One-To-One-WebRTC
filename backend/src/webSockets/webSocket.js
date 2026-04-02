const websocket = require('websocket').server
const https = require('https')

const CF_APP_ID     = process.env.CF_APP_ID
const CF_APP_SECRET = process.env.CF_APP_SECRET

function getCloudflareTurnCredentials() {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ ttl: 86400 })

        const options = {
            hostname: 'rtc.live.cloudflare.com',
            path: `/v1/turn/keys/${CF_APP_ID}/credentials/generate-ice-servers`, // ✅ SAHI ENDPOINT
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
                        resolve(json.iceServers)
                    } else {
                        reject(new Error("No iceServers: " + data))
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

const initiateWebSocket = (httpServer) => {
    const WebSocketServer = new websocket({ httpServer })
    const rooms = new Map()

    WebSocketServer.on('request', (request) => {
        const connection = request.accept(null, request.origin)
        console.log("Client connected")

        connection.on('message', async (message) => {
            let data
            try {
                data = JSON.parse(message.utf8Data)
            } catch {
                console.error("Invalid JSON received")
                return
            }

            const { type, roomCode, offer, answer, candidate } = data

            if (type === "get-turn-credentials") {
                try {
                    const iceServers = await getCloudflareTurnCredentials()
                    console.log("TURN credentials sent to client")
                    connection.send(JSON.stringify({ type: "turn-credentials", iceServers }))
                } catch (e) {
                    console.error("Cloudflare TURN error:", e.message)
                    connection.send(JSON.stringify({
                        type: "turn-credentials",
                        iceServers: [
                            { urls: "stun:stun.l.google.com:19302" },
                            { urls: "stun:stun1.l.google.com:19302" }
                        ]
                    }))
                }
                return
            }

            if (type === "create") {
                rooms.set(roomCode, { host: connection, peer: null, offer: null })
                console.log("Room created:", roomCode)
                return
            }

            if (type === "offer") {
                const room = rooms.get(roomCode)
                if (!room) return
                room.offer = offer
                console.log("Offer stored:", roomCode)
                if (room.peer) {
                    room.peer.send(JSON.stringify({ type: "offer", offer }))
                }
                return
            }

            if (type === "join") {
                const room = rooms.get(roomCode)
                if (!room) {
                    connection.send(JSON.stringify({ type: "error", message: "Room not found" }))
                    return
                }
                room.peer = connection
                console.log("Peer joined:", roomCode)
                if (room.offer) {
                    room.peer.send(JSON.stringify({ type: "offer", offer: room.offer }))
                }
                return
            }

            if (type === "answer") {
                const room = rooms.get(roomCode)
                if (!room || !room.host) return
                room.host.send(JSON.stringify({ type: "answer", answer }))
                return
            }

            if (type === "ice") {
                const room = rooms.get(roomCode)
                if (!room || !candidate) return
                const target = connection === room.host ? room.peer : room.host
                if (target && target.connected) {
                    target.send(JSON.stringify({ type: "ice", candidate }))
                }
                return
            }

            if (type === "leave") {
                const room = rooms.get(roomCode)
                if (!room) return
                const other = room.host === connection ? room.peer : room.host
                if (other && other.connected) {
                    try { other.send(JSON.stringify({ type: "peer-left" })) } catch {}
                }
                rooms.delete(roomCode)
                console.log("Room deleted:", roomCode)
                return
            }
        })

        connection.on('close', () => {
            console.log("Client disconnected")
            for (const [code, room] of rooms.entries()) {
                if (room.host === connection || room.peer === connection) {
                    const other = room.host === connection ? room.peer : room.host
                    if (other && other.connected) {
                        try { other.send(JSON.stringify({ type: "peer-left" })) } catch {}
                    }
                    rooms.delete(code)
                    console.log("Room deleted on disconnect:", code)
                }
            }
        })
    })
}

module.exports = initiateWebSocket