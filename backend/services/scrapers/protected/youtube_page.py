"""Read video details from YouTube's public watch page without executing scripts."""
import json
import re

from bs4 import BeautifulSoup


def read_video_page(html, video_id=None):
    if not isinstance(html, str):
        return {}
    soup = BeautifulSoup(html, 'html.parser')
    result = {}
    for field, property_name in (('title', 'og:title'), ('description', 'og:description'), ('image', 'og:image')):
        tag = soup.find('meta', property=property_name)
        if tag and isinstance(tag.get('content'), str):
            result[field] = tag['content'].strip()
    for field, name in (('description', 'description'), ('author', 'author')):
        tag = soup.find('meta', attrs={'name': name})
        if not result.get(field) and tag and isinstance(tag.get('content'), str):
            result[field] = tag['content'].strip()
    # raw_decode handles multiline descriptions, escaped quotes and nested braces.
    for script in soup.find_all('script'):
        for match in re.finditer(r'(?:\bytInitialPlayerResponse\b|["\']ytInitialPlayerResponse["\']\s*\])\s*=\s*', script.get_text()):
            try:
                player, _ = json.JSONDecoder().raw_decode(script.get_text()[match.end():])
            except (ValueError, TypeError):
                continue
            details = player.get('videoDetails', {}) if isinstance(player, dict) else {}
            if not isinstance(details, dict) or (video_id and details.get('videoId') != video_id):
                continue
            for field, key in (('description', 'shortDescription'), ('author', 'author')):
                if isinstance(details.get(key), str) and details[key].strip():
                    result[field] = details[key].strip()
    return result
