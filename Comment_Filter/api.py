import time
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import hard_filter as l1
import train

app = FastAPI(title="Cinema Comment Filter AI", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    text: str = Field(..., description="Comment text to analyze")


class AnalyzeResponse(BaseModel):
    valid: bool
    label: str
    cleanedText: str
    finalOutput: str
    finalDecision: str
    spoiler: bool
    spoilerConf: float
    censoredWords: list[str]
    profanityCount: int
    profanityRatio: float
    processTime: float


_SPOILER_KEYWORDS = [
    "spoiler", "tiết lộ", "tiet lo", "twist", "sốc", "shock", "chết", "chết rồi",
    "twist cuối", "kết thúc phim", "nhân vật chính thực ra", "thì ra", "phát hiện ra",
    "đừng đọc", "warning", "spoil", "bí mật", "bí ẩn", "thật ra là", "thực ra là",
    "không ngờ", "sốc nặng", "cực mạnh", "chấn động", "sốc nặng", "chết ở",
    "phút", "phim có twist", "twist ở", "tiết lộ rằng", "người yêu của nhân vật",
    "giết chết", "bị giết", "tự tử", "hy sinh", "cứu được", "cuối phim",
]


def _contains_spoiler_keywords(text: str) -> tuple[bool, float]:
    text_lower = text.lower()
    match_count = sum(1 for kw in _SPOILER_KEYWORDS if kw in text_lower)
    confidence = min(match_count * 0.3, 0.95)
    has_spoiler = match_count >= 2 or confidence >= 0.5
    return has_spoiler, round(confidence, 4)


def _determine_decision(
    layer1_valid: bool,
    is_spoiler: bool,
    spoiler_conf: float,
    profanity_ratio: float,
    sentiment: str,
) -> str:
    if not layer1_valid:
        return "REJECTED"
    if is_spoiler and spoiler_conf >= 0.6:
        return "SPOILER_WARNING"
    if profanity_ratio >= 0.6:
        return "REJECTED"
    return "APPROVED"


@app.post("/api/v1/ai/analyze", response_model=AnalyzeResponse)
async def analyze_comment(req: AnalyzeRequest):
    total_start = time.perf_counter()

    layer1_result = l1.normalize_layer1(req.text)

    sentiment_label = "POSITIVE"
    sentiment_probs = {"POSITIVE": 0.33, "NEGATIVE": 0.33, "SPOILER": 0.33}

    if layer1_result.valid or layer1_result.profanity_count < 5:
        try:
            pred = train.predict(req.text)
            sentiment_label = pred.get("label", "POSITIVE")
            sentiment_probs = pred.get("probabilities", sentiment_probs)
        except Exception:
            pass

    ml_spoiler_conf = float(sentiment_probs.get("SPOILER", 0.0))
    keyword_spoiler, keyword_conf = _contains_spoiler_keywords(req.text)

    if ml_spoiler_conf >= 0.5 or keyword_spoiler:
        spoiler = True
        spoiler_conf = max(ml_spoiler_conf, keyword_conf, 0.5)
    else:
        spoiler = False
        spoiler_conf = round(min(ml_spoiler_conf, 0.3), 4)

    if sentiment_label == "SPOILER":
        spoiler = True
        spoiler_conf = max(spoiler_conf, 0.6)

    final_decision = _determine_decision(
        layer1_valid=layer1_result.valid,
        is_spoiler=spoiler,
        spoiler_conf=spoiler_conf,
        profanity_ratio=layer1_result.profanity_ratio,
        sentiment=sentiment_label,
    )

    total_ms = (time.perf_counter() - total_start) * 1000

    return AnalyzeResponse(
        valid=layer1_result.valid,
        label=sentiment_label,
        cleanedText=layer1_result.cleaned_text,
        finalOutput=layer1_result.cleaned_text,
        finalDecision=final_decision,
        spoiler=spoiler,
        spoilerConf=round(spoiler_conf, 4),
        censoredWords=layer1_result.censored_words,
        profanityCount=layer1_result.profanity_count,
        profanityRatio=round(layer1_result.profanity_ratio, 4),
        processTime=round(total_ms, 2),
    )


if __name__ == "__main__":
    import uvicorn

    model = train.load_model()
    if model:
        print("[OK] ML Model loaded")
    else:
        print("[WARN] ML Model not found — run python train.py first")

    uvicorn.run("api:app", host="0.0.0.0", port=8081, reload=False)
