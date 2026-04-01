import { useState, useEffect, useRef } from "react"
import "./App.css"

const generateRoomId = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}

function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    idle:         "Not connected",
    connecting:   "Connecting...",
    waiting:      "Waiting for peer...",
    connected:    "Connected",
    disconnected: "Disconnected",
  }
  return (
    <div className="status-badge">
      <span className={`status-dot status-dot--${status}`} />
      <span className="status-label">{map[status] || "Idle"}</span>
    </div>
  )
}

export default function App() {
  const [roomCode, setRoomCode]     = useState("")
  const [screen, setScreen]         = useState("lobby")
  const [callStatus, setCallStatus] = useState("idle")
  const [isMuted, setIsMuted]       = useState(false)
  const [isCamOff, setIsCamOff]     = useState(false)
  const [toasts, setToasts]         = useState([])
  const [copied, setCopied]         = useState(false)
  const [activeRoom, setActiveRoom] = useState("")

  const roomCodeRef    = useRef("")
  const wsRef          = useRef(null)
  const lcRef          = useRef(null)
  const streamRef      = useRef(null)
  const localVideoRef  = useRef(null)
  const remoteVideoRef = useRef(null)

  useEffect(() => { roomCodeRef.current = roomCode }, [roomCode])

  const addToast = (message, type = "info", duration = 4000) => {
    const id = Date.now()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration)
  }

  useEffect(() => {
    const ws = new WebSocket(`ws://${process.env.serverURL}:3000`)
    wsRef.current = ws

    ws.onopen = () => console.log("WS connected")

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data)

      if (data.type === "error") {
        addToast(data.message || "Something went wrong", "error")
        setCallStatus("idle")
        setScreen("lobby")
        cleanup()
        return
      }

      if (data.type === "offer") {
        if (!lcRef.current) await createPeerConnection()
        await lcRef.current.setRemoteDescription(data.offer)
        const answer = await lcRef.current.createAnswer()
        await lcRef.current.setLocalDescription(answer)
        ws.send(JSON.stringify({ type: "answer", roomCode: roomCodeRef.current, answer: lcRef.current.localDescription }))
        setCallStatus("connecting")
      }

      if (data.type === "answer") {
        await lcRef.current.setRemoteDescription(data.answer)
      }

      if (data.type === "ice") {
        if (data.candidate && lcRef.current) {
          try { await lcRef.current.addIceCandidate(data.candidate) } catch {}
        }
      }

      if (data.type === "peer-left") {
        addToast("The other person left the call", "info")
        setCallStatus("disconnected")
      }
    }

    ws.onerror = () => addToast("WebSocket connection failed. Is the server running?", "error")
    ws.onclose = () => {}

    return () => ws.close()
  }, [])

  async function createPeerConnection() {
    const lc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" }
      ]
    })
    lcRef.current = lc

    lc.onicecandidate = (e) => {
      if (e.candidate) {
        wsRef.current.send(JSON.stringify({ type: "ice", roomCode: roomCodeRef.current, candidate: e.candidate }))
      }
    }

    lc.ontrack = (e) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]
      setCallStatus("connected")
    }

    lc.onconnectionstatechange = () => {
      const state = lc.connectionState
      if (state === "connected")                           { setCallStatus("connected"); addToast("Call connected", "success") }
      if (state === "disconnected" || state === "failed")  { setCallStatus("disconnected"); addToast("Connection lost", "error") }
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch {
      addToast("Camera/mic access denied. Please allow permissions.", "error")
      throw new Error("media denied")
    }

    streamRef.current = stream
    if (localVideoRef.current) localVideoRef.current.srcObject = stream
    stream.getTracks().forEach(track => lc.addTrack(track, stream))
    return lc
  }

  function cleanup() {
    lcRef.current?.close()
    lcRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (localVideoRef.current)  localVideoRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
  }

  async function createRoom() {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) { addToast("Not connected to server", "error"); return }
    if (!roomCode.trim()) { addToast("Enter or generate a room code first", "error"); return }

    try {
      setCallStatus("waiting")
      setActiveRoom(roomCode)
      await createPeerConnection()
      ws.send(JSON.stringify({ type: "create", roomCode: roomCodeRef.current }))
      const offer = await lcRef.current.createOffer()
      await lcRef.current.setLocalDescription(offer)
      ws.send(JSON.stringify({ type: "offer", roomCode: roomCodeRef.current, offer: lcRef.current.localDescription }))
      setScreen("call")
      addToast("Room created. Share the code with your peer.", "success")
    } catch {
      cleanup()
      setCallStatus("idle")
    }
  }

  async function joinRoom() {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) { addToast("Not connected to server", "error"); return }
    if (!roomCode.trim()) { addToast("Enter a room code to join", "error"); return }
    if (roomCode.trim().length < 4) { addToast("Room code is too short", "error"); return }

    try {
      setCallStatus("connecting")
      setActiveRoom(roomCode)
      await createPeerConnection()
      ws.send(JSON.stringify({ type: "join", roomCode: roomCodeRef.current }))
      setScreen("call")
    } catch {
      cleanup()
      setCallStatus("idle")
      setScreen("lobby")
    }
  }

  function toggleMute() {
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled })
    setIsMuted(m => !m)
  }

  function toggleCam() {
    streamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled })
    setIsCamOff(c => !c)
  }

  function leaveCall() {
    wsRef.current?.send(JSON.stringify({ type: "leave", roomCode: activeRoom }))
    cleanup()
    setCallStatus("idle")
    setScreen("lobby")
    setIsMuted(false)
    setIsCamOff(false)
    setActiveRoom("")
    addToast("You left the call", "info")
  }

  function copyRoom() {
    navigator.clipboard.writeText(activeRoom || roomCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <Toast toasts={toasts} />

      {/* LOBBY */}
      {screen === "lobby" && (
        <div className="lobby-wrap">
          <div className="card">
            <div className="logo-row">
              <div className="logo-icon" />
              <span className="logo-text">Link<strong>Call</strong></span>
            </div>

            <h1 className="headline">Start a video call</h1>
            <p className="subtitle">No sign-up. Share a code, connect instantly.</p>

            <label className="field-label">Room Code</label>
            <div className="input-wrap">
              <input
                className="room-input"
                placeholder="e.g. ABC123"
                value={roomCode}
                onChange={e => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                onKeyDown={e => e.key === "Enter" && joinRoom()}
                maxLength={8}
              />
              <button
                className="btn-gen"
                title="Generate random code"
                onClick={() => setRoomCode(generateRoomId())}
              >
                &#8635;
              </button>
            </div>
            <p className="hint">Click &#8635; to generate a random code or type your own</p>

            <div className="btn-row">
              <button className="btn btn--primary" onClick={createRoom}>Create Room</button>
              <button className="btn btn--secondary" onClick={joinRoom}>Join Room</button>
            </div>

            <div className="divider"><span>how it works</span></div>

            <ol className="steps">
              <li>Generate or type a room code</li>
              <li>Click Create Room and share the code</li>
              <li>Your peer enters the code and joins</li>
            </ol>
          </div>
        </div>
      )}

      {/* CALL */}
      {screen === "call" && (
        <div className="call-wrap">
          <div className="call-header">
            <div className="call-header-left">
              <span className="call-title">LinkCall</span>
              <StatusBadge status={callStatus} />
            </div>
            <button className="room-chip" onClick={copyRoom} title="Click to copy">
              <span className="room-chip-code">{activeRoom}</span>
              <span className="room-chip-action">{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          <div className="videos">
            <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />

            {(callStatus === "waiting" || callStatus === "connecting") && (
              <div className="status-overlay">
                <div className="spinner" />
                {callStatus === "waiting" ? (
                  <div className="waiting-box">
                    <p className="waiting-label">Waiting for someone to join</p>
                    <div className="waiting-code">{activeRoom}</div>
                    <p className="waiting-hint">Share this code with your peer</p>
                    <button className="copy-btn" onClick={copyRoom}>
                      {copied ? "Copied!" : "Copy Code"}
                    </button>
                  </div>
                ) : (
                  <p className="overlay-label">Connecting to peer...</p>
                )}
              </div>
            )}

            {callStatus === "disconnected" && (
              <div className="status-overlay">
                <p className="overlay-label">Peer disconnected</p>
                <button className="btn btn--primary" onClick={leaveCall}>Back to Lobby</button>
              </div>
            )}

            <div className="local-pip">
              <video ref={localVideoRef} className="local-video" autoPlay muted playsInline />
              {isCamOff && <div className="cam-off-label">Camera Off</div>}
            </div>
          </div>

          <div className="controls-bar">
            <button className={`ctrl-btn${isMuted ? " ctrl-btn--active" : ""}`} onClick={toggleMute}>
              <span className="ctrl-icon">{isMuted ? "Mic Off" : "Mic"}</span>
            </button>
            <button className={`ctrl-btn${isCamOff ? " ctrl-btn--active" : ""}`} onClick={toggleCam}>
              <span className="ctrl-icon">{isCamOff ? "Cam Off" : "Cam"}</span>
            </button>
            <button className="ctrl-btn ctrl-btn--end" onClick={leaveCall}>
              End Call
            </button>
          </div>
        </div>
      )}
    </>
  )
}