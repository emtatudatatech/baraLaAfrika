from __future__ import annotations

import os
from pathlib import Path

import pytest

from pipelines.africa_pipelines import settings
from pipelines.cli import build_parser, main


def test_help_lists_program_name(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["--help"])
    assert exit_info.value.code == 0
    assert "python -m pipelines" in capsys.readouterr().out


def test_parser_requires_a_command() -> None:
    with pytest.raises(SystemExit):
        build_parser([]).parse_args([])


def test_troy_ounce_constant_comes_from_shared_config() -> None:
    assert settings.troy_oz_per_tonne() == 32150.7466


def test_require_env_names_the_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL_WRITE", raising=False)
    with pytest.raises(settings.MissingSettingError, match="DATABASE_URL_WRITE"):
        settings.require_env("DATABASE_URL_WRITE", purpose="write to Neon")


def test_load_dotenv_does_not_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env = tmp_path / ".env"
    env.write_text("BLA_TEST_A=from_file\nBLA_TEST_B='quoted'\n# comment\n")
    monkeypatch.setenv("BLA_TEST_A", "from_env")
    monkeypatch.delenv("BLA_TEST_B", raising=False)
    settings.load_dotenv(env)
    assert os.environ["BLA_TEST_A"] == "from_env"
    assert os.environ["BLA_TEST_B"] == "quoted"
    monkeypatch.delenv("BLA_TEST_B")


def test_require_env_drops_quotes_and_refuses_a_pasted_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BLA_TEST_KEY", ' "abc123" ')
    assert settings.require_env("BLA_TEST_KEY", purpose="test") == "abc123"
    monkeypatch.setenv("BLA_TEST_KEY", "BLA_TEST_KEY=abc123")
    with pytest.raises(settings.MissingSettingError, match="value alone"):
        settings.require_env("BLA_TEST_KEY", purpose="test")
