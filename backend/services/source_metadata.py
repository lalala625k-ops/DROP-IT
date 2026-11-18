"""Project image-source labels from the same parser dispatch used by link cards."""
from backend.services.remote_image import _public_url
from backend.services.scraper_service import scrape_url_metadata
from backend.services.web_requests import source_request_scope


def read_source_metadata(url: str) -> dict:
    if not _public_url(url, allow_proxy_dns=True):
        return {}
    with source_request_scope():
        result = scrape_url_metadata(url, source_only=True)
    # Source mode skips cover-only network work inside the existing parsers.
    # Never send their cover, canonical URL or card-type output to image cards.
    return {key: value.strip() for key in ('title', 'favicon')
            if isinstance(value := result.get(key), str) and value.strip()
            and (key != 'title' or value.strip() != url)}
