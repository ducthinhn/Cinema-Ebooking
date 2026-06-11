import re
import time
import unicodedata
from dataclasses import dataclass
from typing import List


@dataclass
class Layer1Result:
    valid: bool
    cleaned_text: str
    censored_words: List[str]
    profanity_count: int
    profanity_ratio: float
    process_time_ms: float
    reject_reason: str = ""


_PROFANITY_TABLE: List[dict] = [
    {
        "base": "địt",
        "variants": ["địt", "đjt", "đj", "đjt m", "đjt mẹ", "địt mẹ", "đm", "dm", "đmm", "đụ", "đụ m", "đụ má", "đmẹ"],
        "level": 3,
    },
    {
        "base": "lồn",
        "variants": ["lồn", "l0n", "lòn", "ln", "lồn c", "lồn m", "lồn má", "lồn mẹ", "lôn"],
        "level": 3,
    },
    {
        "base": "cặc",
        "variants": ["cặc", "cac", "cacc", "cặk"],
        "level": 3,
    },
    {
        "base": "buồi",
        "variants": ["buồi", "buoi", "bu0i"],
        "level": 3,
    },
    {
        "base": "dkm",
        "variants": ["dkm", "đkm", "đcm", "dcm"],
        "level": 3,
    },
    {
        "base": "đĩ",
        "variants": ["đĩ", "đĩ má"],
        "level": 2,
    },
    {
        "base": "súc vật",
        "variants": ["súc vật", "suc vat", "súc vat", "thú vật"],
        "level": 2,
    },
    {
        "base": "vl",
        "variants": ["vl", "vkl", "vcl", "vk"],
        "level": 3,
    },
]

# Lookup nhanh: variant → base, base → level
_VARIANT_TO_BASE: dict = {}
_BASE_TO_LEVEL: dict = {}
for _entry in _PROFANITY_TABLE:
    _base = _entry["base"]
    _level = _entry["level"]
    for _variant in _entry["variants"]:
        _VARIANT_TO_BASE[_variant.lower()] = _base
        _BASE_TO_LEVEL[_base] = _level

_VARIANT_LENGTHS: dict = {v: len(v) for v in _VARIANT_TO_BASE}


# ─── LEVENSHTEIN DISTANCE ─────────────────────────────────────────────────────
def _levenshtein(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return _levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = list(range(len(s2) + 1))
    curr = [0] * (len(s2) + 1)
    for i, c1 in enumerate(s1):
        curr[0] = i + 1
        for j, c2 in enumerate(s2):
            ins = prev[j + 1] + 1
            dele = curr[j] + 1
            sub = prev[j] + (c1 != c2)
            curr[j + 1] = min(ins, dele, sub)
        prev, curr = curr, prev
    return prev[len(s2)]


# Cho phép sai tối đa 15% độ dài variant; chỉ áp dụng cho từ >= 5 ký tự
_FUZZY_THRESHOLD_RATIO = 0.15


def _find_profanity_fuzzy(word: str) -> List[tuple]:
    """Tìm từ tục bằng Levenshtein. Chỉ chạy khi word_len >= 5 VÀ variant_len >= 5
    để tránh false positive với từ ngắn tiếng Việt (buồn/buồi, bạn/bán, ...).
    """
    w = word.lower()
    word_len = len(w)
    results = []
    for variant, v_len in _VARIANT_LENGTHS.items():
        if word_len <= 4 or v_len <= 4:
            continue
        threshold = max(1, int(v_len * _FUZZY_THRESHOLD_RATIO))
        if _levenshtein(w, variant) > threshold:
            continue
        base = _VARIANT_TO_BASE[variant]
        results.append((base, _BASE_TO_LEVEL[base], _levenshtein(w, variant)))
    if results:
        results.sort(key=lambda x: (x[1], x[2]))
        return [results[0]]
    return []

# ─── TEENCODE ─────────────────────────────────────────────────────────────────
_TEENCODE_MAP: dict = {
    "ko": "không", "k": "không", "kg": "không", "hk": "không", "k0": "không",
    "dc": "được", "đc": "được", "dk": "được", "đk": "được",
    # Đại từ
    "mk": "mình", "mik": "mình", "m": "mình",
    "mn": "mọi người",
    "t": "tôi",
    "e": "em",
    "bn": "bạn",
    "ngta": "người ta",
    # Động từ / trạng từ phổ biến
    "ns": "nói", "nt": "như thế", "nc": "nói chung",
    "bít": "biết", "bit": "biết", "bic": "biết",
    "cx": "cũng", "cg": "cũng",
    "vs": "với",
    "v": "vậy", "z": "vậy", "zậy": "vậy",
    "ntn": "như thế nào",
    "nma": "nhưng mà", "nhma": "nhưng mà", "nm": "như mà",
    # Thời gian
    "bh": "bây giờ", "bg": "bây giờ",
    "hn": "hôm nay", "hnay": "hôm nay", "hnaj": "hôm nay",
    # Trạng từ / tính từ
    "lm": "làm",
    "qá": "quá", "wá": "quá", "qa": "quá", "q": "quá",
    "nge": "nghe",
    "r": "rồi",
    "j": "gì", "jv": "gì vậy", "g": "gì",
    "p": "phim", "phj": "phim", "pjm": "phim",
    "x": "xem",
    "dep": "đẹp",
    "bt": "bình thường", "bth": "bình thường",
    # Danh từ viết tắt
    "nv": "nhân vật", "nvc": "nhân vật chính",
    "kq": "kết quả",
    "tr": "trời",
    "ak": "á",
}


def _replace_teencode(text: str) -> str:
    """Thay teencode thành tiếng Việt chuẩn.
    Xử lý token-by-token (không substring) để tránh false positive.
    """
    tokens = re.findall(r"[.,!?;:]+|[^\s.,!?;:]+|\s+", text)
    out = []
    for token in tokens:
        if re.fullmatch(r"[.,!?;:]+", token) or token.isspace():
            out.append(token)
        else:
            out.append(_TEENCODE_MAP.get(token.lower(), token))
    return "".join(out).strip()


# ─── SPAM DETECTION ───────────────────────────────────────────────────────────
_SPAM_PATTERNS = [
    r"(.)\1{5,}",                                                               # ký tự lặp 6+ lần
    r"[A-Z]{8,}",                                                               # VIẾT HOA LIÊN TỤC DÀI
    r"https?://\S+",                                                            # URL http/https
    r"www\.\S+",                                                                # URL www
    r"\b(free|win|click|link|bấm|nhấn|tải|tặng)\b.*\b(link|url|code|now)\b",  # spam kêu gọi
    r"\b(casino|gambling|betting)\b",                                           # cờ bạc
    r"\b(spam|quảng cáo)\b",                                                    # tự khai
    r"[!@#$%^&*]{5,}",                                                          # ký tự đặc biệt lặp
    r"^\s*[\W_]{5,}\s*$",                                                       # toàn ký tự đặc biệt
    r"\b(buy|sell|order|giảm giá|khuyến mãi)\b.*\b(link|code|now|click)\b",   # quảng cáo mua bán
]

_SPAM_REGEX = re.compile("|".join(_SPAM_PATTERNS), re.IGNORECASE)


# ─── TOKEN REGEX ──────────────────────────────────────────────────────────────
_VN_CHARS = r"ăâáắấàảãạằầẩẫậđẹêéếềểễệíìỉĩịôốộờớởỡợúùủũụưứừửữựýỳỷỹỵ"

_TOKEN_REGEX = re.compile(
    rf"[\w{_VN_CHARS}]+"
    rf"|[^\s\w{_VN_CHARS}]+"
    r"|\s+"
)


# ─── HELPERS ─────────────────────────────────────────────────────────────────
def _censor_word(word: str) -> str:
    """Thay từ tục bằng dấu *, giữ nguyên độ dài và khoảng trắng bên trong."""
    return "".join(c if c.isspace() else "*" for c in word)


def _normalize_sentences(text: str) -> str:
    """Chuẩn hóa khoảng cách sau dấu câu và viết hoa đầu câu.

    Ví dụ:
        "phim hay lắm .xem ngay đi!tôi thích"
        → "Phim hay lắm. Xem ngay đi! Tôi thích"
    """
    # Xóa khoảng trắng thừa TRƯỚC dấu câu: "hay lắm ." → "hay lắm."
    text = re.sub(r"\s+([.!?,;:])", r"\1", text)

    # Đảm bảo đúng 1 khoảng trắng SAU dấu câu kết thúc câu (., !, ?)
    # Chỉ khi tiếp theo là chữ cái (không phải số hay dấu câu khác)
    text = re.sub(r"([.!?])\s*(?=[^\s\d.!?])", r"\1 ", text)

    def _cap_first(s: str) -> str:
        for i, ch in enumerate(s):
            if ch.isalpha():
                return s[:i] + ch.upper() + s[i + 1:]
        return s

    # Viết hoa đầu mỗi câu (sau ". ", "! ", "? ")
    parts = re.split(r"(?<=[.!?] )", text)
    text = "".join(_cap_first(p) for p in parts)

    # Viết hoa chữ đầu tiên toàn văn bản
    return _cap_first(text)


# ─── MAIN FILTER ─────────────────────────────────────────────────────────────
def normalize_layer1(text: str) -> Layer1Result:
    start = time.perf_counter()

    # 1. Strip null bytes + length guard
    text = text.replace("\x00", "").strip()
    if not text:
        return _reject(start, text, "EMPTY_INPUT")
    if len(text) < 3:
        return _reject(start, text, "TOO_SHORT")
    if len(text) > 2000:
        return _reject(start, text, "TOO_LONG")

    # 2. Unicode NFC
    text = unicodedata.normalize("NFC", text)

    # 3. Strip URL
    text = re.sub(r"https?://\S+|www\.\S+", " ", text)

    # 4. Strip ký tự đặc biệt (giữ chữ cái, chữ số, dấu câu cơ bản, ký tự tiếng Việt)
    text = re.sub(
        rf"[^\w\s,.!?;:()\-{_VN_CHARS}]",
        " ",
        text,
    )

    # 5. Collapse ký tự lặp ≥3 → 1: "vlll" → "vl", "haaaaha" → "haha"
    text = re.sub(r"(.)\1{2,}", r"\1", text)

    # 6. Normalize whitespace
    text = " ".join(text.split())
    if not text:
        return _reject(start, text, "EMPTY_AFTER_CLEAN")

    # 7. Spam detection
    spam_match = _SPAM_REGEX.search(text)
    if spam_match:
        return _reject(start, "", "SPAM")

    # 8. Teencode → tiếng Việt chuẩn
    text = _replace_teencode(text)

    # 9. Profanity detection theo từng token
    tokens = _TOKEN_REGEX.findall(text)
    cleaned_tokens: List[str] = []
    censored_words: List[str] = []
    profanity_count = 0
    word_count = 0

    for token in tokens:
        if token.isspace():
            cleaned_tokens.append(token)
            continue

        word_count += 1
        lower = token.lower()

        # 9a. Exact match
        if lower in _VARIANT_TO_BASE:
            base = _VARIANT_TO_BASE[lower]
            profanity_count += 1
            censored_words.append(base)
            cleaned_tokens.append(_censor_word(token))
            continue

        # 9b. Fuzzy match (Levenshtein) — chỉ với từ đủ dài
        if len(token) >= 5:
            fuzzy = _find_profanity_fuzzy(token)
            if fuzzy:
                base, level, dist = fuzzy[0]
                profanity_count += 1
                censored_words.append(f"{base} (~{token})")
                cleaned_tokens.append(_censor_word(token))
                continue

        cleaned_tokens.append(token)

    cleaned_text = "".join(cleaned_tokens)
    profanity_ratio = profanity_count / max(word_count, 1)

    # 10. Từ chối nếu mật độ từ tục quá cao
    if profanity_ratio >= 0.5 and profanity_count >= 3:
        return _reject(
            start, cleaned_text, "HIGH_PROFANITY",
            censored_words=censored_words,
            profanity_count=profanity_count,
            profanity_ratio=profanity_ratio,
        )

    # 11. Chuẩn hóa câu
    cleaned_text = _normalize_sentences(cleaned_text)

    elapsed = (time.perf_counter() - start) * 1000
    return Layer1Result(
        valid=True,
        cleaned_text=cleaned_text,
        censored_words=censored_words,
        profanity_count=profanity_count,
        profanity_ratio=profanity_ratio,
        process_time_ms=elapsed,
        reject_reason="",
    )


def _reject(
    start: float,
    cleaned_text: str,
    reason: str,
    censored_words: List[str] = None,
    profanity_count: int = 0,
    profanity_ratio: float = 0.0,
) -> Layer1Result:
    elapsed = (time.perf_counter() - start) * 1000
    return Layer1Result(
        valid=False,
        cleaned_text=cleaned_text or "",
        censored_words=censored_words or [],
        profanity_count=profanity_count,
        profanity_ratio=profanity_ratio,
        process_time_ms=elapsed,
        reject_reason=reason,
    )

# ─── DEBUG HELPER ─────────────────────────────────────────────────────────────
def explain_filter(text: str) -> dict:
    result = normalize_layer1(text)
    token_report = []
    for t in _TOKEN_REGEX.findall(text):
        if t.isspace():
            continue
        lower = t.lower()
        if lower in _VARIANT_TO_BASE:
            token_report.append({"token": t, "status": "PROFANITY", "base": _VARIANT_TO_BASE[lower]})
        else:
            fuzzy = _find_profanity_fuzzy(t)
            if fuzzy:
                base, level, dist = fuzzy[0]
                token_report.append({"token": t, "status": "FUZZY", "base": base, "distance": dist})
            else:
                token_report.append({"token": t, "status": "CLEAN"})

    spam_match = _SPAM_REGEX.search(text)
    return {
        "original": text,
        "valid": result.valid,
        "cleaned": result.cleaned_text,
        "reject_reason": result.reject_reason,
        "profanity_count": result.profanity_count,
        "profanity_ratio": round(result.profanity_ratio, 4),
        "censored_words": result.censored_words,
        "process_time_ms": round(result.process_time_ms, 3),
        "is_spam": spam_match is not None,
        "spam_match": spam_match.group() if spam_match else None,
        "token_report": token_report,
    }

if __name__ == "__main__":
    pass