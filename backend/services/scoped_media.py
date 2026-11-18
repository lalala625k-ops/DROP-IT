"""Keep recovered media references local to the board that owns the copy."""
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from backend.services.draft_resources import resource_target, TEXT_METADATA
from backend.services.workspace_session import board_key


def scope_media(state):
    if isinstance(state, dict):
        return {key: value if key in TEXT_METADATA else scope_media(value) for key, value in state.items()}
    if isinstance(state, list):
        return [scope_media(value) for value in state]
    if not isinstance(state, str) or resource_target(state) is None:
        return state
    parts = urlsplit(state)
    query = [(key, value) for key, value in parse_qsl(parts.query) if key != "board_id"]
    if board_key.get():
        query.append(("board_id", board_key.get()))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
