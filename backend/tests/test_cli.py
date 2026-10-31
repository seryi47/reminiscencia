import pytest

from sonidos.cli import main


def test_cli_import_and_list(tone_wav, tmp_path, capsys):
    db = tmp_path / "library.sqlite"

    assert main(["--db", str(db), "import", str(tone_wav), "--license", "propia"]) == 0
    assert main(["--db", str(db), "list"]) == 0

    assert "tono" in capsys.readouterr().out


def test_cli_refuses_import_without_license(tone_wav, tmp_path):
    db = tmp_path / "library.sqlite"

    # --license es obligatorio: argparse termina con código 2.
    with pytest.raises(SystemExit) as error:
        main(["--db", str(db), "import", str(tone_wav)])
    assert error.value.code == 2


def test_cli_export_index_writes_json(tone_wav, tmp_path):
    db = tmp_path / "library.sqlite"
    output = tmp_path / "songs.json"
    main(["--db", str(db), "import", str(tone_wav), "--license", "propia"])

    assert main(["--db", str(db), "export-index", "--output", str(output)]) == 0
    assert output.exists()
