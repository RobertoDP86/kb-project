import requests, pathlib
url = "http://127.0.0.1:8000/tts_stream"
payload = {"text": "Pronto, questo è solo un test."}

with requests.post(url, json=payload, stream=True) as r:
    r.raise_for_status()
    with open("out.mp3", "wb") as f:
        for chunk in r.iter_content(chunk_size=4096):
            if chunk:
                f.write(chunk)

print("Salvato out.mp3 – riproducilo per ascoltare.")
