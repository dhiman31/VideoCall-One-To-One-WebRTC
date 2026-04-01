const websocket = require('websocket').server

const initiateWebSocket = (httpServer) => {

    const WebSocketServer = new websocket({ httpServer })

    const rooms = new Map()

    WebSocketServer.on('request', (request) => {
        const connection = request.accept(null, request.origin)
        console.log("Client connected")

        connection.on('message', (message) => {
            const data = JSON.parse(message.utf8Data)
            const { type, roomCode, offer, answer, candidate } = data

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
                if (target) {
                    target.send(JSON.stringify({ type: "ice", candidate }))
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
                    console.log("🗑 Room deleted:", code)
                }
            }
        })
    })
}

module.exports = initiateWebSocket