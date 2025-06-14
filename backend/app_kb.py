# ───────────────────────── app_kb.py ─────────────────────────
import os, base64, json, anyio, httpx, websockets, collections
from typing import AsyncGenerator, Deque, Tuple, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from openai import AsyncOpenAI

# ─── Chiavi ──────────────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ELEVEN_API_KEY = os.getenv("ELEVEN_API_KEY")
VOICE_ID       = "IvLWq57RKibBrqZGpQrC"

MODEL_LLM = "gpt-3.5-turbo-0125"
MAX_TOK   = 90

client = AsyncOpenAI(api_key=OPENAI_API_KEY)

SYSTEM_PROMPT = (
    "Sei KB, consulente bancario empatico. "
    "Rispondi in italiano, in massimo DUE frasi concise, "
    "e proponi l'appuntamento."
)

# ─── Memoria conversazione ───────────────────────────────────
Memory: dict[str, Deque[Tuple[str, str]]] = {}
MAX_TURNS = 12

def remember(session_id: str, role: str, content: str) -> List[dict]:
    if session_id not in Memory:
        Memory[session_id] = collections.deque(maxlen=MAX_TURNS * 2)
    Memory[session_id].append((role, content))

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for r, c in Memory[session_id]:
        messages.append({"role": r, "content": c})
    return messages

# ─── FastAPI ─────────────────────────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

class Msg(BaseModel):
    text: str
    session_id: str = "default"

# ─── GPT stream ──────────────────────────────────────────────
async def llm_stream(user_text: str, session_id: str) -> AsyncGenerator[str, None]:
    msgs = remember(session_id, "user", user_text)
    resp = await client.chat.completions.create(
        model=MODEL_LLM,
        messages=msgs,
        max_tokens=MAX_TOK,
        temperature=0.7,
        stream=True,
    )

    collected = ""
    async for chunk in resp:
        tok = chunk.choices[0].delta.content
        if tok:
            collected += tok
            yield tok

    remember(session_id, "assistant", collected)

# ─── ElevenLabs WebSocket ────────────────────────────────────
async def eleven_ws_stream(text: str) -> AsyncGenerator[bytes, None]:
    ws_url = (
        f"wss://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
        "/stream-input?model_id=eleven_multilingual_v2"
    )
    async with websockets.connect(ws_url, max_size=None) as ws:   # ← linea completa
        await ws.send(json.dumps({
            "text": " ",
            "xi_api_key": ELEVEN_API_KEY,
            "voice_settings": {
                "stability": 0.28, "similarity_boost": 0.95,
                "use_speaker_boost": True, "style": 0.65 },
            "generation_config": { "chunk_length_schedule": [120,160,250,290] }
        }))
        await ws.send(json.dumps({"text": text, "flush": True}))
        await ws.send(json.dumps({"text": ""}))

        while True:
            data = json.loads(await ws.recv())
            if (b64 := data.get("audio")):
                yield base64.b64decode(b64)
            if data.get("isFinal"):
                break

# ─── End-point API ───────────────────────────────────────────
@app.post("/chat")
async def chat_api(msg: Msg):
    return StreamingResponse(
        llm_stream(msg.text, msg.session_id),
        media_type="text/plain"
    )

@app.post("/tts_stream")
async def tts_stream_api(msg: Msg):
    return StreamingResponse(
        eleven_ws_stream(msg.text),
        media_type="audio/mpeg"
    )

# (legacy) /tts ------------------------------------------------
def _tts_blocking(text: str) -> bytes:
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    r = httpx.post(
        url,
        headers={
            "xi-api-key": ELEVEN_API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        json={
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "output_format": "mp3_22050_32",
            "voice_settings": {
                "stability": 0.28, "similarity_boost": 0.95,
                "use_speaker_boost": True, "style": 0.65 },
        },
        timeout=60,
    )
    r.raise_for_status()
    return r.content

@app.post("/tts")
async def tts_api(msg: Msg):
    audio = await anyio.to_thread.run_sync(_tts_blocking, msg.text)
    b64   = base64.b64encode(audio).decode()
    return JSONResponse({"b64": b64})
# ─────────────────────────────────────────────────────────────
