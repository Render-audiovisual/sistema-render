#!/usr/bin/env python3
"""Entrada compatible al cliente canónico de Mía en backend/scripts."""

import pathlib
import runpy


CLIENT = pathlib.Path(__file__).resolve().parents[1] / "backend" / "scripts" / "mia_render_os_task.py"


if __name__ == "__main__":
    runpy.run_path(str(CLIENT), run_name="__main__")
