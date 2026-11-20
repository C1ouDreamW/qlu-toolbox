import json
import os
import tempfile
from contextlib import suppress

from django.conf import settings


DOWNLOAD_URL = "https://lumatile.cn/download/#download-android"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as output:
            temporary = output.name
            json.dump(value, output, ensure_ascii=False)
            output.write("\n")
            os.fchmod(output.fileno(), 0o644)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            with suppress(FileNotFoundError):
                os.unlink(temporary)


def policy_path():
    return settings.UPDATE_DIR / "android" / "server.json"


def distribution_policy():
    return {"mode": "server" if policy_path().is_file() else "website", "websiteUrl": DOWNLOAD_URL}
