const http = require('http')
const initiateWebSocket = require('./webSockets/webSocket')
const PORT = process.env.PORT || 3000
const httpServer = http.createServer()

httpServer.listen(PORT, () => {
    console.log("HTTP server started on PORT", PORT)
    initiateWebSocket(httpServer)
})