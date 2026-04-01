const http = require('http')
const initiateWebSocket = require('./webSockets/webSocket')
const websocket = require('websocket').server
const PORT = process.env.PORT || 3000
const httpServer = http.createServer()
const WebSocketServer = new websocket({"httpServer" : httpServer})

httpServer.listen(PORT , () => {
    console.log("The http server started on PORT",PORT)

    initiateWebSocket(httpServer)
})

