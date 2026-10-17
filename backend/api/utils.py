import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (compatible; OPIOWBot/1.0; +https://opiow.app)"

CATEGORIES = [
    ("video", "Video", r"youtube|youtu\.be|vimeo|netflix|twitch|tiktok|dailymotion|video|movie|film|series|showmax"),
    ("social", "Social", r"facebook|instagram|twitter|x\.com|linkedin|reddit|snapchat|pinterest|threads|whatsapp|telegram|discord|social"),
    ("news", "News", r"news|bbc|cnn|reuters|nytimes|guardian|aljazeera|nation\.africa|standardmedia|citizen|times|post\b"),
    ("shopping", "Shopping", r"amazon|ebay|aliexpress|etsy|jumia|kilimall|shop|store|deal|sale|buy"),
    ("music", "Music", r"spotify|soundcloud|music|deezer|boomplay|audiomack|podcast|radio"),
    ("tech", "Tech & coding", r"github|gitlab|stackoverflow|npmjs|developer|dev\.to|code|tech|software|programming|api\b"),
    ("learn", "Learning", r"wikipedia|coursera|udemy|khan|edu|learn|course|tutorial|academy|\.ac\."),
    ("games", "Games", r"game|steam|epicgames|xbox|playstation|fifa|ea\.com|gaming"),
    ("sports", "Sports", r"sport|espn|football|soccer|nba|premierleague|goal\.com|fifa"),
    ("finance", "Money", r"bank|finance|crypto|binance|invest|trading|forex|betting|bet\b|mpesa|money"),
    ("other", "Other", r""),
]
CATEGORY_IDS = [c[0] for c in CATEGORIES]


def clean_category(raw):
    """Turn what someone typed into a category id: a built-in one, or their own ('Street food' -> 'street-food')."""
    raw = (raw or "").strip().lower() if isinstance(raw, str) else ""
    if raw in CATEGORY_IDS:
        return raw
    for cid, name, _rx in CATEGORIES:
        if raw == name.lower():
            return cid
    return re.sub(r"[^a-z0-9]+", "-", raw).strip("-")[:20].strip("-") or None


def category_name(cid):
    for i, n, _ in CATEGORIES:
        if i == cid:
            return n
    return cid.replace("-", " ").title()


def categorize(host: str, title: str = "") -> str:
    text = f"{host} {title}".lower()
    for cid, _name, rx in CATEGORIES:
        if cid != "other" and re.search(rx, text):
            return cid
    return "other"


def normalize_url(raw: str):
    raw = (raw or "").strip()
    if not raw:
        return None
    if not re.match(r"^https?://", raw, re.I):
        raw = "https://" + raw
    p = urlparse(raw)
    if not p.netloc or "." not in p.netloc.split("@")[-1].split(":")[0]:
        return None
    return raw


def host_of(url: str) -> str:
    return re.sub(r"^www\.", "", urlparse(url).netloc.lower())


def key_of(url: str) -> str:
    p = urlparse(url)
    return (re.sub(r"^www\.", "", p.netloc.lower()) + p.path.rstrip("/")).lower() + (("?" + p.query) if p.query else "")


def pretty_host(host: str) -> str:
    n = host.split(".")[0] if host else host
    return n[:1].upper() + n[1:]


def is_safe_url(url: str) -> bool:
    """Reject URLs pointing at private/loopback addresses (SSRF protection)."""
    try:
        host = urlparse(url).hostname
        if not host:
            return False
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True
    except Exception:
        return False


def fetch_meta(url: str) -> dict:
    """Read the Open Graph / Twitter preview of a page: title, description, image, logo."""
    out = {"title": "", "description": "", "image": "", "logo": ""}
    if not is_safe_url(url):
        return out
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept": "text/html"}, timeout=6, stream=True)
        raw = b""
        for chunk in r.iter_content(65536):
            raw += chunk
            if len(raw) > 600_000:
                break
        soup = BeautifulSoup(raw, "html.parser")

        def meta(*names):
            for n in names:
                tag = soup.find("meta", attrs={"property": n}) or soup.find("meta", attrs={"name": n})
                if tag and tag.get("content"):
                    return tag["content"].strip()
            return ""

        out["title"] = meta("og:title", "twitter:title") or (soup.title.string.strip() if soup.title and soup.title.string else "")
        out["description"] = meta("og:description", "twitter:description", "description")
        if not out["description"]:        # no description tag: the first real paragraph of the page will do
            for p in soup.find_all("p"):
                text = " ".join(p.get_text(" ", strip=True).split())
                if len(text) >= 60:
                    out["description"] = text[:300]
                    break
        img = meta("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")
        if img:
            out["image"] = urljoin(url, img).replace("http://", "https://", 1)
        icon = soup.find("link", rel=lambda v: v and "icon" in v)
        if icon and icon.get("href"):
            out["logo"] = urljoin(url, icon["href"])
    except Exception:
        pass
    return out


def is_active(url: str) -> bool:
    """A link is 'active' if the site answers."""
    if not is_safe_url(url):
        return False
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=6, stream=True, allow_redirects=True)
        return r.status_code < 400
    except Exception:
        return False


def screenshot_url(url: str) -> str:
    return "https://image.thum.io/get/width/700/crop/440/noanimate/" + url
