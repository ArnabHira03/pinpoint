import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_")

    data_dir: Path = BACKEND_DIR / "data"
    # Empty means a local SQLite file. Hosted, this is the Supabase session pooler address.
    database_url: str = ""

    @property
    def is_hosted_database(self) -> bool:
        return bool(self.database_url)

    @property
    def resolved_database_url(self) -> str:
        url = self.database_url
        if not url:
            # Render's disk is wiped on every restart, so SQLite there would lose everything.
            if os.environ.get("RENDER"):
                raise RuntimeError("APP_DATABASE_URL must be set on Render")
            return f"sqlite:///{self.data_dir / 'app.db'}"
        for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url.removeprefix(prefix)
        raise RuntimeError("APP_DATABASE_URL must be a Postgres address")
