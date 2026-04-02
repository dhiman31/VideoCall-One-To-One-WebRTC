const websocket = require('websocket').server
const https = require('https')

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN

function getTwilioToken() {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')

        const options = {
            hostname: 'api.twilio.com',
            path: `/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Tokens.json`,
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Length': 0
            }
        }

        const req = https.request(options, (res) => {
            let body = ''
            res.on('data', d => body += d)
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body))
                } catch (e) {
                    reject(e)
                }
            })
        })

        req.on('error', reject)
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
            const data = JSON.parse(message.utf8Data)
            const { type, roomCode, offer, answer, candidate } = data

            if (type === "get-turn-credentials") {
                try {
                    const token = await getTwilioToken()
                    connection.send(JSON.stringify({
                        type: "turn-credentials",
                        iceServers: token.ice_servers
                    }))
                    console.log("TURN credentials sent")
                } catch (e) {
                    console.error("Twilio error:", e.message)
                    connection.send(JSON.stringify({
                        type: "turn-credentials",
                        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
                    }))
                }
                return
            }

            if (type === "create") {
                rooms.set(roomCode, { host: connection, peer: null, offer: null })
                console.log("Room created:", roomCode)
            }

            if (type === "offer") {
                const room = rooms.get(roomCode)
                if (!room) return
                room.offer = offer
                console.log("Offer stored for room:", roomCode)
                if (room.peer) {
                    console.log("Forwarding offer to waiting peer")
                    room.peer.send(JSON.stringify({ type: "offer", offer }))
                }
            }

            if (type === "join") {
                const room = rooms.get(roomCode)
                if (!room) {
                    connection.send(JSON.stringify({ type: "error", message: "Room not found" }))
                    return
                }
                room.peer = connection
                console.log("Peer joined room:", roomCode)
                if (room.offer) {
                    console.log("Sending stored offer to peer")
                    connection.send(JSON.stringify({ type: "offer", offer: room.offer }))
                }
            }

            if (type === "answer") {
                const room = rooms.get(roomCode)
                if (!room || !room.host) return
                console.log("Forwarding answer to host")
                room.host.send(JSON.stringify({ type: "answer", answer }))
            }

            if (type === "ice") {
                const room = rooms.get(roomCode)
                if (!room || !candidate) return
                const target = connection === room.host ? room.peer : room.host
                if (target && target.connected) {
                    target.send(JSON.stringify({ type: "ice", candidate }))
                }
            }

            if (type === "leave") {
                for (const [code, room] of rooms.entries()) {
                    if (room.host === connection || room.peer === connection) {
                        const other = room.host === connection ? room.peer : room.host
                        if (other) {
                            try { other.send(JSON.stringify({ type: "peer-left" })) } catch {}
                        }
                        rooms.delete(code)
                        console.log("Room deleted:", code)
                    }
                }
            }
        })

        connection.on('close', () => {
            console.log("Client disconnected")
            for (const [code, room] of rooms.entries()) {
                if (room.host === connection || room.peer === connection) {
                    const other = room.host === connection ? room.peer : room.host
                    if (other) {
                        try { other.send(JSON.stringify({ type: "peer-left" })) } catch {}
                    }
                    rooms.delete(code)
                    console.log("Room deleted:", code)
                }
            }
        })
    })
}

module.exports = initiateWebSocket