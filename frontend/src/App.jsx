import { useState, useRef, useEffect } from "react";
import ChatBubble from "./components/ChatBubble";
import Spinner from "./components/Spinner";
import { Sun, Moon, Volume2, VolumeX } from "lucide-react";

const API = "http://127.0.0.1:8002";               // porta backend
const USE_MSE = "MediaSource" in window;           // supporto Media Source

export default function App() {
  /* ───── state ───── */
  const [log,     setLog]     = useState([]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [mute,    setMute]    = useState(false);
  const [dark,    setDark]    = useState(false);

  /* ───── refs ───── */
  const bottomRef   = useRef();
  const queueRef    = useRef([]);
  const playingRef  = useRef(false);

  /* auto-scroll */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, loading]);

  /* ───────── QUEUE logic ───────── */
  const enqueue = async sentence => {
    if (mute) return;
    queueRef.current.push(sentence);
    if (!playingRef.current) playNext();
  };

  const playNext = async () => {
    if (!queueRef.current.length) { playingRef.current = false; return; }
    playingRef.current = true;
    const sentence = queueRef.current.shift();

    if (USE_MSE) {
      await playStreaming(sentence);      // low-latency path
    } else {
      await playBuffered(sentence);       // fallback
    }
    playNext();
  };

  /* ---- Low-latency streaming with MediaSource ---- */
  async function playStreaming(text) {
    return new Promise(async resolve => {
      const mediaSource = new MediaSource();
      const url = URL.createObjectURL(mediaSource);
      const audio = new Audio(url);
      audio.autoplay = true;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };

      mediaSource.addEventListener("sourceopen", async () => {
        const mime = 'audio/mpeg';                    // MP3 chunks
        const sb = mediaSource.addSourceBuffer(mime);

        const res = await fetch(`${API}/tts_stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        const reader = res.body.getReader();

        let first = true;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          await new Promise(r => {
            sb.addEventListener("updateend", r, { once: true });
            sb.appendBuffer(value);
          });
          if (first) { audio.play(); first = false; }
        }
        mediaSource.endOfStream();
      });
    });
  }

  /* ---- Fallback: buffer intero (come fase 2) ---- */
  async function playBuffered(text) {
    const res    = await fetch(`${API}/tts_stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const reader = res.body.getReader();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const blob  = new Blob(chunks, { type: "audio/mpeg" });
    const url   = URL.createObjectURL(blob);
    await new Promise(res => {
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); res(); };
      audio.play();
    });
  }

  /* ───────── SEND message ───────── */
  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setLog(l => [...l, { role: "user", text }]);

    setLoading(true);
    const res    = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const reader = res.body.getReader();
    let aiText = "", sentence = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      aiText   += chunk;
      sentence += chunk;
      if (/[.?!]\s*$/.test(sentence)) { await enqueue(sentence); sentence = ""; }
      setLog(l => [...l.slice(0, -1), { role: "assistant", text: aiText }]);
    }
    if (sentence) await enqueue(sentence);
    setLoading(false);
  }

  /* ───────── UI ───────── */
  return (
    <div className={dark ? "dark" : ""}>
      <div className="h-screen flex flex-col bg-slate-100 dark:bg-slate-900 transition-colors">
        {/* header */}
        <header className="px-4 py-2 flex justify-between items-center bg-white/80 dark:bg-slate-800/80 shadow">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
            KB Chat – React
          </h1>
          <div className="flex gap-3">
            <button onClick={() => setMute(m => !m)} title={mute ? "Attiva audio" : "Muta audio"}>
              {mute ? <VolumeX className="w-5 h-5 text-red-500" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <button onClick={() => setDark(d => !d)} title="Toggle dark">
              {dark ? <Sun className="w-5 h-5 text-yellow-400" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* chat */}
        <main className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {log.map((m, i) => <ChatBubble key={i} role={m.role} text={m.text} />)}
          {loading && <Spinner />}
          <div ref={bottomRef} />
        </main>

        {/* input */}
        <footer className="p-3 bg-white/80 dark:bg-slate-800/80">
          <div className="flex gap-2">
            <input
              className="flex-1 p-2 rounded border dark:bg-slate-700 dark:text-slate-100"
              placeholder="Scrivi qui..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              autoFocus
            />
            <button className="px-4 bg-blue-600 text-white rounded" onClick={send}>
              Invia
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
