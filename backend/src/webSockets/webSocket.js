const initiateWebSocket = (httpServer) => {

    const WebSocketServer = new websocket({"httpServer" : httpServer})

    const rooms = new Map();

    WebSocketServer.on('request', (request) => {
        const connection = request.accept(null , request.origin)
        
        connection.on('message' , (message) => {
            const data = JSON.parse(message.utf8Data);
            const { type, roomCode, offer, answer } = data;

            if(type === "create") {
                rooms.set(roomCode, {
                    host: connection,
                    peer: null,
                    offer: null
                });
                console.log("Room created:", roomCode);
            }

            if (type === "offer") {
                const room = rooms.get(roomCode);
                if (!room) return;

                room.offer = offer;
                console.log("Offer stored");
                }
            })

            if (type === "join") {
                const room = rooms.get(roomCode);
                if (!room) return;

                room.peer = connection;
                console.log("Peer joined:", roomCode);

                if(room.offer) {
                    console.log("Sending stored offer");
                    connection.send(JSON.stringify({
                    type: "offer",
                    offer: room.offer
                    }));
                }
            }


            if(type === "answer") {
                const room = rooms.get(roomCode);
                if (!room) return;

                console.log("Answer → sending to host");

                room.host.send(JSON.stringify({
                    type: "answer",
                    answer
                }));
            }

        connection.on('close' , () => {
            console.log("WS connection is ended!!")
            for (const [code, room] of rooms.entries()) {
                if (room.host === connection || room.peer === connection) {
                    rooms.delete(code);
                    console.log("Room deleted:", code);
                }
            }
        })
    })

}

module.exports = initiateWebSocket