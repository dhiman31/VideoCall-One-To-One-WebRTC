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
        <div key={t.id} className={`toast toast--${t.type}`}>{t.message}</div>
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

  const roomCodeRef        = useRef("")
  const wsRef              = useRef(null)
  const lcRef              = useRef(null)
  const streamRef          = useRef(null)
  const localVideoRef      = useRef(null)
  const remoteVideoRef     = useRef(null)
  const iceCandidateBuffer = useRef([])
  const isCreatorRef       = useRef(false)   // creator vs joiner track karo

  useEffect(() => { roomCodeRef.current = roomCode }, [roomCode])

  const addToast = (message, type = "info", duration = 4000) => {
    const id = Date.now()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration)
  }

  // Server se Cloudflare TURN credentials fetch karo
  function getTurnCredentials() {
    return new Promise((resolve) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        resolve([{ urls: "stun:stun.l.google.com:19302" }])
        return
      }

      const handler = (event) => {
        let data
        try { data = JSON.parse(event.data) } catch { return }
        if (data.type === "turn-credentials") {
          ws.removeEventListener("message", handler)
          console.log("Got ICE servers:", JSON.stringify(data.iceServers))
          resolve(data.iceServers)
        }
      }

      ws.addEventListener("message", handler)
      ws.send(JSON.stringify({ type: "get-turn-credentials" }))

      // 6 sec timeout — fallback to STUN only
      setTimeout(() => {
        ws.removeEventListener("message", handler)
        console.warn("TURN credentials timeout — using STUN fallback")
        resolve([
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" }
        ])
      }, 6000)
    })
  }

  useEffect(() => {
    const ws = new WebSocket("wss://videocall-server-8rr8.onrender.com")
    wsRef.current = ws

    ws.onopen = () => console.log("WS connected")

    ws.onmessage = async (event) => {
      let data
      try { data = JSON.parse(event.data) } catch { return }

      // turn-credentials — getTurnCredentials() handle karti hai
      if (data.type === "turn-credentials") return

      if (data.type === "error") {
        addToast(data.message || "Something went wrong", "error")
        setCallStatus("idle")
        setScreen("lobby")
        cleanup()
        return
      }

      // ── OFFER ── sirf joiner handle kare
      if (data.type === "offer") {
        if (isCreatorRef.current) {
          console.log("Creator — ignoring offer")
          return
        }

        if (!lcRef.current) await createPeerConnection()
        await lcRef.current.setRemoteDescription(data.offer)
        const answer = await lcRef.current.createAnswer()
        await lcRef.current.setLocalDescription(answer)
        wsRef.current.send(JSON.stringify({
          type: "answer",
          roomCode: roomCodeRef.current,
          answer: lcRef.current.localDescription
        }))
        setCallStatus("connecting")

        // Buffered ICE candidates flush karo
        for (const c of iceCandidateBuffer.current) {
          try { await lcRef.current.addIceCandidate(c) } catch {}
        }
        iceCandidateBuffer.current = []
        return
      }

      // ── ANSWER ── sirf creator handle kare
      if (data.type === "answer") {
        if (!isCreatorRef.current) {
          console.log("Joiner — ignoring answer")
          return
        }
        if (!lcRef.current) return
        await lcRef.current.setRemoteDescription(data.answer)

        // Buffered ICE candidates flush karo
        for (const c of iceCandidateBuffer.current) {
          try { await lcRef.current.addIceCandidate(c) } catch {}
        }
        iceCandidateBuffer.current = []
        return
      }

      // ── ICE ───────────────────────────────────────────────────────
      if (data.type === "ice") {
        if (!data.candidate || !lcRef.current) return
        if (lcRef.current.remoteDescription) {
          try { await lcRef.current.addIceCandidate(data.candidate) } catch {}
        } else {
          iceCandidateBuffer.current.push(data.candidate)
        }
        return
      }

      if (data.type === "peer-left") {
        addToast("The other person left the call", "info")
        setCallStatus("disconnected")
        return
      }
    }

    ws.onerror = () => addToast("WebSocket connection failed", "error")
    ws.onclose = () => console.log("WS closed")

    return () => ws.close()
  }, [])

  async function createPeerConnection() {
    const iceServers = await getTurnCredentials()
    console.log("Creating peer connection with:", JSON.stringify(iceServers))

    const lc = new RTCPeerConnection({ iceServers })
    lcRef.current = lc

    lc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log("Sending ICE type:", e.candidate.type)
        wsRef.current.send(JSON.stringify({
          type: "ice",
          roomCode: roomCodeRef.current,
          candidate: e.candidate
        }))
      }
    }

    lc.oniceconnectionstatechange = () => {
      console.log("ICE STATE:", lc.iceConnectionState)
      if (lc.iceConnectionState === "failed") {
        console.log("ICE failed — restarting")
        lc.restartIce()
      }
    }

    lc.onconnectionstatechange = () => {
      const state = lc.connectionState
      console.log("CONNECTION STATE:", state)
      if (state === "connected") {
        setCallStatus("connected")
        addToast("Call connected!", "success")
      }
      if (state === "failed") {
        console.log("Connection failed — restarting ICE")
        lc.restartIce()
      }
    }

    lc.ontrack = (e) => {
      console.log("Remote track received")
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0]
      }
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch {
      addToast("Camera/mic access denied", "error")
      throw new Error("media denied")
    }

    streamRef.current = stream
    if (localVideoRef.current) localVideoRef.current.srcObject = stream
    stream.getTracks().forEach(track => lc.addTrack(track, stream))

    return lc
  }

  function cleanup() {
    isCreatorRef.current = false
    iceCandidateBuffer.current = []
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
      isCreatorRef.current = true
      setCallStatus("waiting")
      setActiveRoom(roomCode)
      setScreen("call")
      await new Promise(r => setTimeout(r, 50)) // DOM render hone do

      await createPeerConnection()

      ws.send(JSON.stringify({ type: "create", roomCode: roomCodeRef.current }))

      const offer = await lcRef.current.createOffer()
      await lcRef.current.setLocalDescription(offer)

      ws.send(JSON.stringify({
        type: "offer",
        roomCode: roomCodeRef.current,
        offer: lcRef.current.localDescription
      }))

      addToast("Room created! Share the code.", "success")
    } catch (e) {
      console.error("createRoom error:", e)
      cleanup()
      setCallStatus("idle")
      setScreen("lobby")
    }
  }

  async function joinRoom() {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) { addToast("Not connected to server", "error"); return }
    if (!roomCode.trim()) { addToast("Enter a room code to join", "error"); return }
    if (roomCode.trim().length < 4) { addToast("Room code is too short", "error"); return }

    try {
      isCreatorRef.current = false
      setCallStatus("connecting")
      setActiveRoom(roomCode)
      setScreen("call")
      await new Promise(r => setTimeout(r, 50)) // DOM render hone do

      await createPeerConnection()

      ws.send(JSON.stringify({ type: "join", roomCode: roomCodeRef.current }))
    } catch (e) {
      console.error("joinRoom error:", e)
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
              <button className="btn-gen" title="Generate random code" onClick={() => setRoomCode(generateRoomId())}>
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