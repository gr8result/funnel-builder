# transcribe-local/server.py
# Local transcription server (NO per-use cost)
# Endpoint: POST /transcribe (multipart form file="audio")
#
# Uses faster-whisper (CPU). Model: base (good speed). You can change to "small" later.

from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel
import tempfile
import os

app = FastAPI()

# CPU model. For better accuracy later: "small" or "medium"
MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")

# device="cpu" for no-cost local machine.
# compute_type="int8" makes CPU faster.
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    try:
        suffix = os.path.splitext(file.filename or "")[1] or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        segments, info = model.transcribe(tmp_path, vad_filter=True)
        text = " ".join([s.text.strip() for s in segments]).strip()

        try:
            os.unlink(tmp_path)
        except:
            pass

        return JSONResponse({"ok": True, "text": text, "language": getattr(info, "language", None)})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
