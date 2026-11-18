"""Capture X's official public post representation without account cookies."""
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
from backend.services.screenshot_service import capture_screenshot_fallback


def post_is_rendered(html: str, status_id: str) -> bool:
    soup = BeautifulSoup(html, 'html.parser')
    # A script/bootstrap containing an ID is not proof of a rendered post.
    text = soup.select_one('.Tweet-text, .tweet-text, [data-testid="tweetText"]')
    if not text or not text.get_text(strip=True):
        return False
    for anchor in soup.select('a[href]'):
        target = urlsplit(anchor.get('href', ''))
        if target.hostname in ('twitter.com', 'www.twitter.com', 'x.com', 'www.x.com') \
                and target.path.rstrip('/').endswith(f'/status/{status_id}'):
            return True
    return False


def capture_post(status_id: str, *, timeout: float = 18) -> str:
    if not status_id.isdigit() or timeout <= 0:
        return ''
    # The public embed shows the same post when the full X page needs login.
    url = f'https://platform.twitter.com/embed/Tweet.html?id={status_id}&theme=light&dnt=true'
    return capture_screenshot_fallback(url, timeout=timeout,
                                       validate_page=lambda html: post_is_rendered(html, status_id),
                                       trim_background=True, retry_after=min(7, timeout / 2)) or ''
