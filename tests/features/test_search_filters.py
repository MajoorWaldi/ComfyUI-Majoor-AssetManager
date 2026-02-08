import datetime

from backend.routes.handlers import search as search_mod


def test_parse_inline_query_filters_extracts_extensions_and_rating():
    query, filters = search_mod._parse_inline_query_filters('ext:PNG rating:5 forest')
    assert filters['extensions'] == ['png']
    assert filters['min_rating'] == 5
    assert query == 'forest'


def test_parse_inline_query_filters_handles_kind_and_clamps_rating():
    query, filters = search_mod._parse_inline_query_filters('kind:Video ext:.WebP rating:6 stray')
    assert filters['kind'] == 'video'
    assert filters['extensions'] == ['webp']
    assert filters['min_rating'] == 5
    assert query == 'stray'


def test_parse_inline_query_filters_leaves_unhandled_tokens():
    query, filters = search_mod._parse_inline_query_filters('foo:bar rating:two ext:')
    assert query == 'foo:bar rating:two ext:'
    assert not filters


def test_date_bounds_range_uses_utc_reference():
    reference = datetime.datetime(2026, 2, 7, 23, 45, tzinfo=datetime.timezone.utc)
    start, end = search_mod._date_bounds_for_range('today', reference=reference)
    expected = int(datetime.datetime(2026, 2, 7, tzinfo=datetime.timezone.utc).timestamp())
    assert start == expected
    assert end == expected + 86400


def test_date_bounds_exact_anchors_to_utc_midnight():
    start, end = search_mod._date_bounds_for_exact('2026-02-01')
    expected = int(datetime.datetime(2026, 2, 1, tzinfo=datetime.timezone.utc).timestamp())
    assert start == expected
    assert end == expected + 86400
