from app.ingestion.docx_processor import split_text


def test_split_text_preserves_overlap() -> None:
    chunks = split_text("one two three four five six", chunk_size=4, overlap=1)
    assert [chunk.content for chunk in chunks] == ["one two three four", "four five six"]


def test_split_text_rejects_invalid_overlap() -> None:
    try:
        split_text("content", chunk_size=2, overlap=2)
    except ValueError as exc:
        assert "overlap" in str(exc)
    else:
        raise AssertionError("Expected invalid overlap to fail")
