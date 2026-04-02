const websocket = require('websocket').server
const https = require('https')

const CF_APP_ID     = process.env.CF_APP_ID
const CF_APP_SECRET = process.env.CF_APP_SECRET

function getCloudflareTurnCredentials() {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ ttl: 86400 })

        const options = {
            hostname: 'rtc.live.cloudflare.com',
            path: `/v1/turn/keys/${CF_APP_ID}/credentials/generate`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CF_APP_SECRET}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }

        const req = https.request(options, (res) => {
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => {
                try {
                    const json = JSON.parse(data)
                    console.log("Cloudflare response:", JSON.stringify(json))
                    if (json.iceServers) {
                        resolve(json.iceServers)
                    } else {
                        reject(new Error("No iceServers in response: " + data))
                    }
                } catch (e) {
                    reject(new Error("Parse error: " + data))
                }
            })
        })

        req.on('error', reject)
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

            //TURN CREDENTIALS
            if (type === "get-turn-credentials") {
                try {
                    const iceServers = await getCloudflareTurnCredentials()
                    console.log("TURN credentials sent to client")
                    connection.send(JSON.stringify({
                        type: "turn-credentials",
                        iceServers
                    }))
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

            //CREATE ROOM
            if (type === "create") {
                rooms.set(roomCode, { host: connection, peer: null, offer: null })
                console.log("Room created:", roomCode)
                return
            }

            //STORE OFFER
            if (type === "offer") {
                const room = rooms.get(roomCode)
                if (!room) return
                room.offer = offer
                console.log("Offer stored:", roomCode)
            
                if (room.peer) {
                    console.log("Peer already waiting — sending offer now")
                    room.peer.send(JSON.stringify({ type: "offer", offer }))
                }
                return
            }

            //JOIN ROOM
            if (type === "join") {
                const room = rooms.get(roomCode)
                if (!room) {
                    connection.send(JSON.stringify({ type: "error", message: "Room not found" }))
                    return
                }
                room.peer = connection
                console.log("Peer joined:", roomCode)
                if (room.offer) {
                    console.log("Sending stored offer to peer")
                    room.peer.send(JSON.stringify({ type: "offer", offer: room.offer }))
                }
                return
            }

            //ANSWER
            if (type === "answer") {
                const room = rooms.get(roomCode)
                if (!room || !room.host) return
                console.log("Forwarding answer to host:", roomCode)
                room.host.send(JSON.stringify({ type: "answer", answer }))
                return
            }

            //ICE CANDIDATE
            if (type === "ice") {
                const room = rooms.get(roomCode)
                if (!room || !candidate) return
                const target = connection === room.host ? room.peer : room.host
                if (target && target.connected) {
                    target.send(JSON.stringify({ type: "ice", candidate }))
                }
                return
            }

            //LEAVE
            if (type === "leave") {
                console.log("Leave received for room:", roomCode)
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

        //CLIENT DISCONNECT
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