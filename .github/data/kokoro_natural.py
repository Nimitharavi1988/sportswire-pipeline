import sys, random, re
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
model, voices, voice, lang, base, out, seed, text = sys.argv[1:9]
base = float(base)
rnd = random.Random(int(seed))
k = Kokoro(model, voices)

def trim(s, sr, thr=0.012, pad=0.03):
    idx = np.where(np.abs(s) > thr)[0]
    if len(idx) == 0:
        return s
    return s[max(0, idx[0] - int(sr * pad)):min(len(s), idx[-1] + int(sr * pad))]

GAPS = {",": (0.12, 0.26), ";": (0.18, 0.30), ":": (0.18, 0.30), ".": (0.32, 0.52), "!": (0.30, 0.50), "?": (0.34, 0.54)}
parts = [p.strip() for p in re.findall(r"[^.,;:!?]+[.,;:!?]?", text) if p.strip()]
chunks = []
sr = 24000
for i, p in enumerate(parts):
    end = p[-1] if p[-1] in GAPS else "."
    sp = base * rnd.uniform(0.96, 1.06)
    if i == 0:
        sp *= 0.96
    if end in ".!?":
        sp *= 0.95
    pitch = 1 + rnd.uniform(-0.03, 0.04)
    s, sr = k.create(p, voice=voice, speed=sp / pitch, lang=lang)
    n = int(len(s) / pitch)
    s = np.interp(np.linspace(0, len(s) - 1, n), np.arange(len(s)), s)
    s = trim(s, sr) * (10 ** (rnd.uniform(-1.2, 1.2) / 20))
    lo, hi = GAPS[end]
    chunks += [s, np.zeros(int(sr * rnd.uniform(lo, hi)))]
sf.write(out, np.concatenate(chunks[:-1]), sr)
