import argparse
import json
import os
import shutil
import signal
import socket
import statistics
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

parser = argparse.ArgumentParser(
    description="Three matched local Node/Bun runtime pairs on synthetic fixtures (Linux)."
)
parser.add_argument("--bun", default=shutil.which("bun"))
parser.add_argument(
    "--node",
    required=True,
    help="Explicit baseline Node binary; never used for application deployment",
)
parser.add_argument("--output", required=True, type=Path)
parser.add_argument(
    "--fixture",
    type=Path,
    help="JSON with DATABASE_URL and AUTH_SECRET for a disposable synthetic database",
)
parser.add_argument(
    "--auth-state",
    type=Path,
    help="Playwright storageState for a synthetic fixture user",
)
parser.add_argument(
    "--mode",
    choices=["all", "queue", "http", "warm-health", "processing"],
    default="all",
)
parser.add_argument(
    "--http-warmup-requests",
    type=int,
    default=20,
    help="Warm-up requests per route before measured HTTP loads",
)
parser.add_argument("--synthetic-fixtures", action="store_true", required=True)
args = parser.parse_args()
if args.http_warmup_requests < 1:
    parser.error("--http-warmup-requests must be positive")
root = Path(__file__).resolve().parents[2]
harness = Path(__file__).resolve().parent
evidence = args.output.resolve()
evidence.mkdir(parents=True, exist_ok=False)
bun = str(Path(args.bun).resolve()) if args.bun else parser.error("Bun binary required")
node = str(Path(args.node).resolve())
fixture = json.loads(args.fixture.read_text()) if args.fixture else {}
http = args.mode in ["all", "http", "warm-health"]
if http:
    if (
        not args.auth_state
        or not fixture.get("DATABASE_URL")
        or not fixture.get("AUTH_SECRET")
    ):
        parser.error("HTTP runs require --fixture and --auth-state")
    if urlparse(fixture["DATABASE_URL"]).hostname not in [
        "localhost",
        "127.0.0.1",
        "::1",
    ]:
        parser.error("Only disposable local databases are supported")
# Explicit allowlist: no inherited provider credentials or automatic .env loading.
env = {
    "PATH": str(Path(bun).parent) + os.pathsep + os.defpath,
    "HOME": str(evidence),
    "NODE_ENV": "production",
    "__NEXT_PROCESSED_ENV": "true",
    "NEXT_TELEMETRY_DISABLED": "1",
    "HOSTNAME": "127.0.0.1",
    "PORT": "3102",
    "AUTH_URL": "http://127.0.0.1:3102",
    "NEXTAUTH_URL": "http://127.0.0.1:3102",
    "AUTH_TRUST_HOST": "true",
    "DATABASE_URL": fixture.get("DATABASE_URL", ""),
    "AUTH_SECRET": fixture.get("AUTH_SECRET", ""),
    "LOG_LEVEL": "silent",
    "REDIS_URL": "redis://127.0.0.1:6379",
    "QDRANT_URL": "http://127.0.0.1:6333",
    "QDRANT_API_KEY": "dev_qdrant_key",
    "S3_BUCKET_DOCUMENTS": "timeline-documents",
    "BENCH_BASE_URL": "http://127.0.0.1:3102",
}
if args.auth_state:
    env["BENCH_AUTH_STATE"] = str(args.auth_state.resolve())


def versions(binary):
    return json.loads(
        subprocess.check_output(
            [binary, "-p", "JSON.stringify(process.versions)"],
            cwd=root,
            env={"PATH": env["PATH"], "HOME": env["HOME"]},
            text=True,
        )
    )


bun_versions = versions(bun)
node_versions = versions(node)
if bun_versions.get("bun") != (root / ".bun-version").read_text().strip():
    parser.error("Bun executable must match the repository .bun-version pin")
if node_versions.get("bun") or not node_versions.get("node"):
    parser.error("Node baseline must be a real Node executable, not a Bun node alias")

metadata = {
    "mode": args.mode,
    "order": ["node", "bun", "bun", "node", "node", "bun"],
    "bunVersion": bun_versions["bun"],
    "nodeVersion": "v" + node_versions["node"],
    "commit": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True
    ).strip(),
    "dirty": bool(
        subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=root, text=True
        ).strip()
    ),
    "comparison": "Same compiled artifact and dependencies; not a historical Node release build",
    "concurrency": 4,
    "queueJobs": 20000,
    "queueWarmupJobs": 1000,
    "httpWarmupRequests": args.http_warmup_requests,
}
(evidence / "method.json").write_text(json.dumps(metadata, indent=2) + "\n")
results = []


def save():
    (evidence / "runtime-performance.json").write_text(json.dumps(results, indent=2))


def stat(pid):
    p = Path("/proc") / str(pid)
    data = (p / "stat").read_text().split()
    status = dict(
        (l.split(":", 1)[0], l.split(":", 1)[1].strip())
        for l in (p / "status").read_text().splitlines()
        if ":" in l
    )
    return {
        "cpuMs": (int(data[13]) + int(data[14])) / os.sysconf("SC_CLK_TCK") * 1000,
        "rssMiB": int(status["VmRSS"].split()[0]) / 1024,
        "peakRssMiB": int(status["VmHWM"].split()[0]) / 1024,
    }


order = [
    ("node", node),
    ("bun", bun),
    ("bun", bun),
    ("node", node),
    ("node", node),
    ("bun", bun),
]
for i, (name, runtime) in enumerate(order if args.mode in ["all", "queue"] else []):
    print(f"queue {i+1}/6 {name}", flush=True)
    output = subprocess.check_output(
        [runtime]
        + (["--no-env-file"] if name == "bun" else [])
        + [str(harness / "queue.mjs")],
        env={"PATH": env["PATH"], "HOME": "/tmp"},
        text=True,
        timeout=180,
    )
    row = json.loads(output.strip().splitlines()[-1])
    row.update(kind="queue", run=i // 2 + 1)
    results.append(row)
    save()
    print(json.dumps(row), flush=True)
for i, (name, runtime) in enumerate(order if http else []):
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("127.0.0.1", 3102))
    print(f"web {i+1}/6 {name}", flush=True)
    with open(evidence / f"http-{i+1}-{name}.log", "w") as log:
        server = subprocess.Popen(
            [runtime]
            + (["--no-env-file"] if name == "bun" else [])
            + [str(root / "apps/web/.next/standalone/apps/web/server.js")],
            cwd=root / "apps/web/.next/standalone/apps/web",
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            import urllib.request

            for attempt in range(120):
                if server.poll() is not None:
                    raise RuntimeError(f"{name} exited; see server log")
                try:
                    with urllib.request.urlopen(
                        "http://127.0.0.1:3102/api/health", timeout=2
                    ) as r:
                        if r.status == 200:
                            break
                except Exception:
                    time.sleep(0.5)
            else:
                raise RuntimeError("server readiness timeout")
            cases = [
                ("/api/health", 5000),
                ("/sign-in", 300),
                ("/app/timeline?mode=events", 300),
            ]
            for route, _ in cases:
                subprocess.check_output(
                    [
                        bun,
                        "--no-env-file",
                        str(harness / "http-load.mjs"),
                        route,
                        str(args.http_warmup_requests),
                        "4",
                    ],
                    env=env,
                    text=True,
                    timeout=120,
                )
            if args.mode == "warm-health":
                subprocess.check_output(
                    [
                        bun,
                        "--no-env-file",
                        str(harness / "http-load.mjs"),
                        "/api/health",
                        "1000",
                        "4",
                    ],
                    env=env,
                    text=True,
                    timeout=180,
                )
            for route, count in (cases[:1] if args.mode == "warm-health" else cases):
                samples = []
                stop = threading.Event()

                def sample():
                    while not stop.wait(0.025):
                        try:
                            samples.append(stat(server.pid)["rssMiB"])
                        except FileNotFoundError:
                            break

                monitor = threading.Thread(target=sample)
                monitor.start()
                before = stat(server.pid)
                try:
                    output = subprocess.check_output(
                        [
                            bun,
                            "--no-env-file",
                            str(harness / "http-load.mjs"),
                            route,
                            str(count),
                            "4",
                        ],
                        env=env,
                        text=True,
                        timeout=180,
                    )
                finally:
                    stop.set()
                    monitor.join()
                after = stat(server.pid)
                row = json.loads(output)
                row.update(
                    kind="http",
                    runtime=name,
                    run=i // 2 + 1,
                    cpuMs=after["cpuMs"] - before["cpuMs"],
                    rssAfterWarmupMiB=before["rssMiB"],
                    rssEndMiB=after["rssMiB"],
                    peakRssMiB=after["peakRssMiB"],
                    steadyRssMiB=(
                        statistics.mean(samples[len(samples) // 2 :])
                        if samples
                        else after["rssMiB"]
                    ),
                )
                results.append(row)
                save()
                print(json.dumps(row), flush=True)
        finally:
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
            try:
                server.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(server.pid, signal.SIGKILL)
                server.wait()
for i, (name, runtime) in enumerate(
    order if args.mode in ["all", "processing"] else []
):
    output = subprocess.check_output(
        [runtime]
        + (["--no-env-file"] if name == "bun" else [])
        + [str(harness / "processing.mjs")],
        env={"PATH": env["PATH"], "HOME": env["HOME"]},
        text=True,
        timeout=180,
    )
    row = json.loads(output)
    row.update(kind="processing", run=i // 2 + 1)
    results.append(row)
    save()
    print(json.dumps(row), flush=True)
for kind in ["queue", "processing"]:
    checksums = {row["checksum"] for row in results if row["kind"] == kind}
    if len(checksums) > 1:
        raise RuntimeError(f"{kind}: runtime output checksums differ")
print("All matched local runs completed", flush=True)
