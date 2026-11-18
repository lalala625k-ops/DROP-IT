from backend.services.scrapers.registry import scraper_registry

def scrape_url_metadata(url: str, *, source_only: bool = False):
    """
    Main entry point for scraping URL metadata and cover image.
    Dispatches to 🔒 Protected -> ⏳ Experimental -> 🌐 Fallback.
    """
    return scraper_registry.scrape(url, source_only=True) if source_only else scraper_registry.scrape(url)

__all__ = ["scrape_url_metadata", "scraper_registry"]
