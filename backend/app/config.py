from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_")

    data_dir: Path = BACKEND_DIR / "data"
    storage_dir: Path = BACKEND_DIR / "storage"
    max_upload_bytes: int = 10 * 1024 * 1024
    allowed_formats: frozenset[str] = frozenset({"PNG", "JPEG", "WEBP", "GIF"})
    max_image_pixels: int = 50_000_000
    cors_origins: list[str] = ["http://localhost:5173"]

    @property
    def screenshots_dir(self) -> Path:
        return self.storage_dir / "screenshots"

    @property
    def tmp_dir(self) -> Path:
        return self.storage_dir / "tmp"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'app.db'}"
