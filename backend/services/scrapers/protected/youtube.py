# ==============================================================================
# RULE ID: P-003 | YouTube
# STATUS: 🔒 PROTECTED (LOCKED - DO NOT MODIFY WITHOUT EXPLICIT USER INSTRUCTION)
# APPROVED: 2026-09-21 (User Confirmed OK)
# ==============================================================================

import re
from typing import Optional
from backend.services.scrapers.base import BaseScraper, ScrapedMetadata
from backend.services.scrapers.protected.youtube_page import read_video_page
from backend.services import web_requests
from backend.services.parse_progress import publish_metadata

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

class YoutubeScraper(BaseScraper):
    name = "youtube"
    status = "PROTECTED"

    def can_handle(self, url: str) -> bool:
        lower = url.lower()
        return "youtube.com" in lower or "youtu.be" in lower

    def scrape(self, url: str, *, source_only: bool = False) -> Optional[ScrapedMetadata]:

        # 1. Extract YouTube Video ID
        vid_match = re.search(r'(?:v=|youtu\.be/|shorts/|embed/)([a-zA-Z0-9_-]{11})', url)
        video_id = vid_match.group(1) if vid_match else None

        title = ""
        description = ""
        author = ""
        image = ""

        if video_id:
            # Reserve the same cover choice while fetching title information first.
            image = hd_img = f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
            # Fetch metadata via official oEmbed API (fast, reliable, no rate-limiting)
            oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
            try:
                r_oembed = web_requests.get(oembed_url, headers=HEADERS, timeout=5)
                if r_oembed.status_code == 200:
                    data = r_oembed.json()
                    title = data.get("title", "")
                    author = data.get("author_name", "")
            except Exception as e:
                print(f"[Protected YouTube] oEmbed error: {e}")

        favicon = 'https://www.youtube.com/s/desktop/b0f1b2cc/img/favicon.ico'
        if not source_only and title:
            publish_metadata({'title': title, 'author': author, 'favicon': favicon})

        # oEmbed has no synopsis. Source-title lookups skip the extra page read.
        if not title or not source_only:
            try:
                r = web_requests.get(url, headers=HEADERS, timeout=6)
                if r.status_code == 200:
                    page = read_video_page(r.text, video_id)
                    title = title or page.get('title', '')
                    description = page.get('description', '')
                    author = author or page.get('author', '')
                    image = image or page.get('image', '')
            except Exception as e:
                print(f"[Protected YouTube] HTML fallback error: {e}")

        if not source_only:
            publish_metadata({'title': title or ('YouTube 视频' if image else url), 'description': description,
                              'author': author, 'favicon': favicon})
        if video_id and not source_only:
            try:
                r_img = web_requests.head(hd_img, headers=HEADERS, timeout=4)
                if r_img.status_code != 200:
                    image = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
            except Exception:
                image = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

        if title or image:
            return {
                "title": title or "YouTube 视频",
                "description": description,
                "author": author,
                "image": image,
                "favicon": "https://www.youtube.com/s/desktop/b0f1b2cc/img/favicon.ico",
                "url": url,
            }

        return None
