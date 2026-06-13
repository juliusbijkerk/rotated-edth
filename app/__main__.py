"""Entry point: detect local IP, print QR codes for operator + unit URLs, start uvicorn."""
import os
import socket
import sys
from pathlib import Path

import qrcode
import uvicorn
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).parent.parent
DIST_DIR = PROJECT_ROOT / "web" / "dist"


def get_local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def print_qr(url: str) -> None:
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make()
    # tty=True uses ANSI codes for a tight render; falls back to ASCII when stdout isn't a tty.
    qr.print_ascii(tty=sys.stdout.isatty(), invert=False)


def main():
    load_dotenv()
    port = int(os.environ.get("ARGUS_PORT", "8000"))
    ip = get_local_ip()
    public_base_url = (
        os.environ.get("ARGUS_PUBLIC_BASE_URL")
        or os.environ.get("PUBLIC_BASE_URL")
        or ""
    ).rstrip("/")

    if not (DIST_DIR / "operator.html").exists():
        print("\n[argus] web/dist/operator.html is missing — run `npm run build` first.\n",
              file=sys.stderr)
        # Continue anyway; the server's /operator route will report 503 with a helpful message.

    if public_base_url:
        operator_url = f"{public_base_url}/operator"
        unit_url = f"{public_base_url}/unit"
    else:
        operator_url = f"http://{ip}:{port}/operator"
        unit_url = f"http://{ip}:{port}/unit"

    bar = "=" * 68
    print()
    print(bar)
    print("  ARGUS · push-to-talk situational awareness")
    print(bar)
    print(f"  Operator:  {operator_url}")
    print(f"  Unit URL:  {unit_url}")
    print(f"  Localhost: http://127.0.0.1:{port}/operator")
    if not public_base_url:
        print("  Phone mic: use HTTPS tunnel URL if LAN HTTP blocks microphone access.")
    print(bar)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("  ! WARNING: ANTHROPIC_API_KEY not set; parsing will fail.")
        print("    Copy .env.example to .env and fill in your key.")
        print(bar)
    print("\n  Operator QR:")
    print_qr(operator_url)
    print("  Unit QR:")
    print_qr(unit_url)
    print(bar)
    print()

    uvicorn.run("app.server:app", host="0.0.0.0", port=port,
                log_level="info", reload=False)


if __name__ == "__main__":
    main()
