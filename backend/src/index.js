const http = require('http')
const websocket = require('websocket').server
const PORT = process.env.PORT || 3000

const httpServer = http.createServer()
const WebSocketServer = new websocket({"httpServer" : httpServer})

httpServer.listen(PORT , () => {
    console.log("The http server started on PORT",PORT)
})

WebSocketServer.on('request', (request) => {
    const connection = request.accept(null , request.origin)

    connection.on('close' , () => {
        console.log("WS connection is ended!!")
    })
})