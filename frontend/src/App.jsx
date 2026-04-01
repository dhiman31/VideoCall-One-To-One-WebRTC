import { useState, useEffect, useRef } from "react"

export default function App() {

  const [roomCode, setRoomCode] = useState("")
  const roomCodeRef = useRef("")
  const wsRef = useRef(null)
  const lcRef = useRef(null)

  useEffect(() => {
    roomCodeRef.current = roomCode
  }, [roomCode])

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:3000")
    wsRef.current = ws

    ws.onopen = () => console.log("WS connected")

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data)
      console.log("📩 WS message:", data.type)

      if (data.type === "offer") {
        console.log("Offer received")

        if (!lcRef.current) {
          await createPeerConnection()
        }

        await lcRef.current.setRemoteDescription(data.offer)
        const answer = await lcRef.current.createAnswer()
        await lcRef.current.setLocalDescription(answer)

        ws.send(JSON.stringify({
          type: "answer",
          roomCode: roomCodeRef.current,
          answer: lcRef.current.localDescription
        }))

        console.log("📤 Answer sent")
      }

      if (data.type === "answer") {
        console.log("📥 Answer received")
        await lcRef.current.setRemoteDescription(data.answer)
      }

      if (data.type === "ice") {
        console.log("📥 ICE received")
        if (data.candidate && lcRef.current) {
          try {
            await lcRef.current.addIceCandidate(data.candidate)
          } catch (e) {
            console.warn("ICE add failed:", e)
          }
        }
      }
    }

    ws.onerror = (e) => console.error("WS error:", e)
    ws.onclose = () => console.log("WS closed")

    return () => ws.close()
  }, [])

  async function createPeerConnection() {
    const lc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ]
    })

    lcRef.current = lc

    lc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log("Sending ICE")
        wsRef.current.send(JSON.stringify({
          type: "ice",
          roomCode: roomCodeRef.current,
          candidate: e.candidate
        }))
      }
    }

    lc.ontrack = (e) => {
      console.log("Remote track received")
      document.getElementById("remoteVideo").srcObject = e.streams[0]
    }

    lc.onconnectionstatechange = () => {
      console.log("Connection state:", lc.connectionState)
    }

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    document.getElementById("localVideo").srcObject = stream
    stream.getTracks().forEach(track => lc.addTrack(track, stream))

    return lc
  }

  async function createRoom() {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("WS not ready")
      return
    }

    await createPeerConnection()

    ws.send(JSON.stringify({ type: "create", roomCode: roomCodeRef.current }))

    const offer = await lcRef.current.createOffer()
    await lcRef.current.setLocalDescription(offer)

    ws.send(JSON.stringify({
      type: "offer",
      roomCode: roomCodeRef.current,
      offer: lcRef.current.localDescription
    }))

    console.log("📤 Offer sent")
  }

  async function joinRoom() {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("WS not ready")
      return
    }

    await createPeerConnection()

    ws.send(JSON.stringify({ type: "join", roomCode: roomCodeRef.current }))

    console.log("📤 Join sent, waiting for offer...")
  }

  return (
    <>
      <h1>Video Calling 1-1</h1>

      <input
        placeholder="Room Code"
        value={roomCode}
        onChange={(e) => setRoomCode(e.target.value)}
      />

      <br /><br />

      <button onClick={createRoom}>Create Room</button>
      <button onClick={joinRoom} style={{ marginLeft: 10 }}>Join Room</button>

      <br /><br />

      <video id="localVideo" autoPlay muted width="300" />
      <video id="remoteVideo" autoPlay playsInline width="300" />
    </>
  )
}