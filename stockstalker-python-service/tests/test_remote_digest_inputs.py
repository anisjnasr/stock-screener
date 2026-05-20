"""Tests for remote digest-inputs HTTP client."""

from __future__ import annotations

import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from large_cap.remote_digest_inputs import fetch_digest_inputs


class TestRemoteDigestInputs(unittest.TestCase):
    @patch.dict(
        "os.environ",
        {
            "SCREENER_DB_REMOTE": "true",
            "STOCK_SCANNER_APP_URL": "https://main.example.test",
            "INTERNAL_API_KEY": "secret",
        },
        clear=False,
    )
    @patch("large_cap.remote_digest_inputs.urllib.request.urlopen")
    def test_fetch_digest_inputs_surfaces_json_error_body(self, mock_urlopen: object) -> None:
        body = json.dumps({"ok": False, "error": "no such column: ema_20_above_ema_50"}).encode()
        err = urllib.error.HTTPError(
            url="https://main.example.test/api/internal/large-cap/digest-inputs?ticker=MU",
            code=400,
            msg="Bad Request",
            hdrs=None,
            fp=io.BytesIO(body),
        )
        mock_urlopen.side_effect = err  # type: ignore[attr-defined]

        with self.assertRaises(ValueError) as ctx:
            fetch_digest_inputs("MU")

        self.assertIn("no such column", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
