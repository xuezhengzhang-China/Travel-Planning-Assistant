"""Prepare the dedicated remote database; never prints credentials."""

import os
from pathlib import Path
import secrets
import subprocess


def main():
    root = Path(__file__).resolve().parents[2]
    env_file = root / ".env"
    if not env_file.exists():
        password = secrets.token_urlsafe(32)
        base_url = f"postgresql://travel_planner:{password}@127.0.0.1:55432"
        overrides = {
            "POSTGRES_DB": "travel_planner",
            "POSTGRES_USER": "travel_planner",
            "POSTGRES_PASSWORD": password,
            "DATABASE_URL": f"{base_url}/travel_planner",
            "TEST_DATABASE_URL": f"{base_url}/travel_planner_b_test",
        }
        template = (root / ".env.example").read_text(encoding="utf-8")
        lines = []
        for line in template.splitlines():
            key = line.split("=", 1)[0]
            lines.append(f"{key}={overrides[key]}" if key in overrides else line)
        # Exclusive creation preserves an existing server configuration.
        descriptor = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write("\n".join(lines) + "\n")
    env_file.chmod(0o600)
    subprocess.run(
        [
            "sudo", "-n", "docker", "compose", "--progress", "plain",
            "--env-file", str(env_file),
            "-f", str(root / "docker-compose.remote-db.yml"),
            "up", "-d", "--wait", "--wait-timeout", "120",
        ],
        cwd=root,
        check=True,
        timeout=180,
    )
    print("Remote PostgreSQL is ready on 127.0.0.1:55432; credentials remain in .env.")


if __name__ == "__main__":
    main()
