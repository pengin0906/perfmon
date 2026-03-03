#!/usr/bin/env python3
"""PerfMon - Organic System Monitor

Architecture:
  - housekeeper collectors: CPU, Memory, Disk, Network, GPU, Temp, Process, Kernel
  - pforce engine pattern: metadata-driven YAML config + store-based KVS
  - pywebview: native window with browser engine (WebKit/GTK) rendering
  - In-memory KVS with sparkline history ring buffer
"""

from __future__ import annotations

import collections
import concurrent.futures
import http.server
import json
import os
import shutil
import sys
import threading
import time
from functools import partial
from pathlib import Path

import yaml
import socket

# Add housekeeper to path
sys.path.insert(0, str(Path(__file__).parent.parent / "housekeeper"))

from housekeeper.collectors.cpu import CpuCollector
from housekeeper.collectors.disk import DiskCollector
from housekeeper.collectors.kernel import KernelCollector
from housekeeper.collectors.memory import MemoryCollector
from housekeeper.collectors.network import NetworkCollector
from housekeeper.collectors.process import ProcessCollector
from housekeeper.collectors.temperature import TemperatureCollector
from housekeeper.collectors.nfs import NfsMountCollector

# Optional collectors (lazy import)
GpuCollector = None
AppleGpuCollector = None
PcieCollector = None
ConntrackCollector = None

try:
    from housekeeper.collectors.gpu import GpuCollector as _GC
    GpuCollector = _GC
except ImportError:
    pass

try:
    from housekeeper.collectors.apple_gpu import AppleGpuCollector as _AGC
    AppleGpuCollector = _AGC
except ImportError:
    pass

try:
    from housekeeper.collectors.pcie import PcieCollector as _PC
    PcieCollector = _PC
except ImportError:
    pass

try:
    from housekeeper.collectors.conntrack import ConntrackCollector as _CC
    ConntrackCollector = _CC
except ImportError:
    pass


# ============================================================
# KVS - In-memory Key-Value Store with sparkline history
# ============================================================

class KVS:
    """Thread-safe in-memory KVS with ring buffer history for sparklines."""

    def __init__(self, history_size: int = 60):
        self._data: dict = {}
        self._sparklines: dict[str, collections.deque] = {}
        self._lock = threading.RLock()
        self._history_size = history_size

    def put(self, key: str, value, sparkline_val=None):
        with self._lock:
            self._data[key] = value
            if sparkline_val is not None:
                if key not in self._sparklines:
                    self._sparklines[key] = collections.deque(maxlen=self._history_size)
                self._sparklines[key].append(sparkline_val)

    def get(self, key: str):
        with self._lock:
            return self._data.get(key)

    def get_all(self) -> dict:
        with self._lock:
            return {
                "metrics": {k: v for k, v in self._data.items()},
                "sparklines": {k: list(v) for k, v in self._sparklines.items()},
            }


# ============================================================
# Collector Engine - background thread collecting metrics
# ============================================================

class CollectorEngine:
    """Runs housekeeper collectors in a background thread, stores results in KVS."""

    def __init__(self, kvs: KVS, config: dict, profile: bool = False):
        self.kvs = kvs
        self.config = config
        self.running = False
        self.profile = profile
        self._profile_data: dict[str, list[float]] = {}
        coll_cfg = config.get("collectors", {})

        # Always-on collectors
        self.cpu = CpuCollector()
        self.memory = MemoryCollector()
        self.disk = DiskCollector()
        self.network = NetworkCollector()
        self.process = ProcessCollector(
            top_n=coll_cfg.get("process", {}).get("top_n", 10)
        )
        self.kernel = KernelCollector()
        self.temperature = TemperatureCollector()

        # Optional collectors
        self.gpu = None
        if GpuCollector and coll_cfg.get("gpu", {}).get("enabled", True):
            g = GpuCollector()
            if g.available():
                self.gpu = g

        self.apple_gpu = None
        if AppleGpuCollector and coll_cfg.get("gpu", {}).get("enabled", True):
            ag = AppleGpuCollector()
            if ag.available():
                self.apple_gpu = ag

        self.pcie = None
        if PcieCollector and coll_cfg.get("pcie", {}).get("enabled", False):
            self.pcie = PcieCollector()

        self.conntrack = None
        if ConntrackCollector and coll_cfg.get("conntrack", {}).get("enabled", False):
            if ConntrackCollector.available():
                self.conntrack = ConntrackCollector()

        # NAS (NFS/CIFS/SMB)
        self.nfs = NfsMountCollector()

        # Baseline reads (diff-based collectors need 2 samples)
        self.cpu.collect()
        self.disk.collect()
        self.network.collect()
        self.process.collect()
        self.kernel.collect()
        if self.pcie:
            self.pcie.collect()
        if self.conntrack:
            self.conntrack.collect()
        self.nfs.collect()

    def start(self):
        self.running = True
        t = threading.Thread(target=self._loop, daemon=True)
        t.start()

    def _loop(self):
        time.sleep(0.3)
        interval = self.config.get("meta", {}).get("refresh_ms", 1500) / 1000.0
        while self.running:
            try:
                t0 = time.monotonic()
                self._collect()
                elapsed = (time.monotonic() - t0) * 1000
                if self.profile:
                    self._profile_data.setdefault("_total", []).append(elapsed)
                    if len(self._profile_data["_total"]) % 5 == 0:
                        self._print_profile()
                self.kvs.put("_profile", {
                    k: round(sum(v[-10:]) / len(v[-10:]), 2)
                    for k, v in self._profile_data.items()
                } if self.profile else None)
            except Exception as e:
                print(f"[collector error] {e}", file=sys.stderr)
            time.sleep(interval)

    def _prof(self, name: str, t0: float):
        if self.profile:
            elapsed = (time.monotonic() - t0) * 1000
            self._profile_data.setdefault(name, []).append(elapsed)

    def _print_profile(self):
        print("\n[profile] Collector costs (avg of last 10, ms):")
        for k, v in sorted(self._profile_data.items()):
            recent = v[-10:]
            avg = sum(recent) / len(recent)
            mx = max(recent)
            print(f"  {k:15s}  avg={avg:7.2f}  max={mx:7.2f}")
        print()

    def _collect(self):
        # ── Phase 1: Fast collectors (sequential, <2ms total) ──
        t0 = time.monotonic()
        cpu_data = self.cpu.collect()
        self._prof("cpu", t0)
        cpu_total_pct = cpu_data[0].total_pct if cpu_data else 0
        self.kvs.put("cpu", [
            {
                "label": c.label, "total": round(c.total_pct, 1),
                "user": round(c.user_pct, 1), "system": round(c.system_pct, 1),
                "iowait": round(c.iowait_pct, 1), "irq": round(c.irq_pct, 1),
                "steal": round(c.steal_pct, 1), "idle": round(c.idle_pct, 1),
            }
            for c in cpu_data
        ], sparkline_val=round(cpu_total_pct, 1))

        t0 = time.monotonic()
        mem, swap = self.memory.collect()
        self._prof("memory", t0)
        self.kvs.put("memory", {
            "total_kb": mem.total_kb, "used_kb": mem.used_kb,
            "buffers_kb": mem.buffers_kb, "cached_kb": mem.cached_kb,
            "free_kb": mem.free_kb, "used_pct": round(mem.used_pct, 1),
            "buffers_pct": round(mem.buffers_pct, 1),
            "cached_pct": round(mem.cached_pct, 1),
            "bw_gbs": round(mem.bw_gbs, 2),
            "bw_read_gbs": round(mem.bw_read_gbs, 2),
            "bw_write_gbs": round(mem.bw_write_gbs, 2),
        }, sparkline_val=round(mem.used_pct, 1))
        self.kvs.put("swap", {
            "total_kb": swap.total_kb, "used_kb": swap.used_kb,
            "free_kb": swap.free_kb, "used_pct": round(swap.used_pct, 1),
        }, sparkline_val=round(swap.used_pct, 1))

        t0 = time.monotonic()
        disk_data = self.disk.collect()
        self._prof("disk", t0)
        self.kvs.put("disk", [
            {
                "name": d.display_name, "read_bps": round(d.read_bytes_sec),
                "write_bps": round(d.write_bytes_sec),
                "read_iops": round(d.read_iops), "write_iops": round(d.write_iops),
                "raid_level": d.raid_level, "raid_member_of": d.raid_member_of,
            }
            for d in disk_data
        ])

        t0 = time.monotonic()
        net_data = self.network.collect()
        self._prof("network", t0)
        self.kvs.put("network", [
            {
                "name": n.display_name, "type": n.net_type.value,
                "rx_bps": round(n.rx_bytes_sec), "tx_bps": round(n.tx_bytes_sec),
                "bond_mode": n.bond_mode, "bond_member_of": n.bond_member_of,
            }
            for n in net_data
        ])

        t0 = time.monotonic()
        k = self.kernel.collect()
        self._prof("kernel", t0)
        self.kvs.put("kernel", {
            "load_1": round(k.load_1, 2), "load_5": round(k.load_5, 2),
            "load_15": round(k.load_15, 2), "uptime": k.uptime_str,
            "running": k.running_procs, "total": k.total_procs,
            "ctx_sec": round(k.ctx_switches_sec),
            "intr_sec": round(k.interrupts_sec),
            "version": k.kernel_version, "cpus": k.num_cpus,
        })

        # ── Phase 2: Heavy collectors (parallel via ThreadPool) ──
        futures = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            # GPU (NVIDIA)
            if self.gpu:
                futures["gpu"] = (time.monotonic(), pool.submit(self.gpu.collect))
            # Apple GPU (Metal)
            if self.apple_gpu:
                futures["apple_gpu"] = (time.monotonic(), pool.submit(self.apple_gpu.collect))
            # Temperature
            futures["temperature"] = (time.monotonic(), pool.submit(self.temperature.collect))
            # Process
            futures["process"] = (time.monotonic(), pool.submit(self.process.collect))
            # PCIe
            if self.pcie:
                futures["pcie"] = (time.monotonic(), pool.submit(self.pcie.collect))
            # Conntrack
            if self.conntrack:
                futures["conntrack"] = (time.monotonic(), pool.submit(self.conntrack.collect))
            # NAS (NFS/CIFS/SMB)
            futures["nfs"] = (time.monotonic(), pool.submit(self.nfs.collect))

            # Wait for all and ingest into KVS
            for name, (t_start, future) in futures.items():
                try:
                    result = future.result(timeout=5)
                except Exception as e:
                    print(f"[collector error] {name}: {e}", file=sys.stderr)
                    continue
                self._prof(name, t_start)
                self._ingest(name, result)

    def _ingest(self, name: str, data):
        """Ingest collector results into KVS."""
        if name == "gpu":
            self.kvs.put("gpu", [
                {
                    "index": g.index, "name": g.short_name,
                    "util": round(g.gpu_util_pct, 1),
                    "mem_used": round(g.mem_used_mib),
                    "mem_total": round(g.mem_total_mib),
                    "mem_pct": round(g.mem_used_pct, 1),
                    "temp": round(g.temperature_c),
                    "temp_mem_junction": round(g.temp_memory_junction_c),
                    "power": round(g.power_draw_w, 1),
                    "power_limit": round(g.power_limit_w, 1),
                    "fan": round(g.fan_speed_pct),
                    "enc": round(g.encoder_util_pct, 1),
                    "dec": round(g.decoder_util_pct, 1),
                }
                for g in data
            ])
        elif name == "apple_gpu":
            self.kvs.put("gpu", [
                {
                    "index": g.index, "name": g.short_name,
                    "util": round(g.gpu_util_pct, 1),
                    "mem_used": round(g.mem_used_mib),
                    "mem_total": round(g.mem_alloc_mib),
                    "mem_pct": round(g.mem_used_pct, 1),
                    "temp": 0,
                    "power": 0,
                    "power_limit": 0,
                    "fan": 0,
                    "enc": 0,
                    "dec": 0,
                    "renderer": round(g.renderer_util_pct, 1),
                    "tiler": round(g.tiler_util_pct, 1),
                    "cores": g.gpu_core_count,
                    "metal": g.metal_family,
                }
                for g in data
            ])
        elif name == "temperature":
            self.kvs.put("temperature", [
                {
                    "name": t.display_name, "category": t.category,
                    "temp": round(t.primary_temp_c, 1),
                    "crit": round(t.primary_crit_c, 1),
                    "max": round(t.primary_max_c, 1),
                    "sensors": [
                        {"label": s.label, "temp": round(s.temp_c, 1),
                         "crit": round(s.crit_c, 1)}
                        for s in t.sensors
                    ],
                    "fans": [
                        {"label": f.label, "rpm": f.rpm}
                        for f in t.fans
                    ],
                }
                for t in data
            ])
        elif name == "process":
            self.kvs.put("process", [
                {
                    "pid": p.pid, "name": p.name,
                    "cpu": round(p.cpu_pct, 1),
                    "mem_mb": round(p.mem_rss_mib, 1),
                    "state": p.state,
                }
                for p in data
            ])
        elif name == "pcie":
            self.kvs.put("pcie", [
                {
                    "address": p.address, "name": p.short_name,
                    "gen": p.gen_name, "width": p.current_width,
                    "max_gen": p.max_gen_name, "max_width": p.max_width,
                    "type": p.device_type,
                    "io_read_bps": round(p.io_read_bytes_sec),
                    "io_write_bps": round(p.io_write_bytes_sec),
                    "max_bw_bps": round(p.max_bandwidth_gbs * 1_073_741_824),
                    "io_label": p.io_label,
                }
                for p in data
            ])
        elif name == "conntrack":
            self.kvs.put("conntrack", [
                {
                    "ip": c.remote_ip, "tx_bps": round(c.tx_bytes_sec),
                    "rx_bps": round(c.rx_bytes_sec), "conns": c.conn_count,
                }
                for c in data
            ])
        elif name == "nfs":
            self.kvs.put("nfs", [
                {
                    "device": n.device, "mount": n.mount_point,
                    "type": n.type_label, "fs_type": n.fs_type,
                    "read_bps": round(n.read_bytes_sec),
                    "write_bps": round(n.write_bytes_sec),
                }
                for n in data
            ])


# ============================================================
# pywebview API (exposed to JavaScript)
# ============================================================

class PerfMonApi:
    """Python API exposed to JS via pywebview bridge.

    Follows pforce's ctx pattern - shared context for all operations.
    """

    def __init__(self, kvs: KVS, config_path: str, config: dict):
        self.kvs = kvs
        self.config_path = config_path
        self.config = config

    def get_metrics(self) -> dict:
        """Called by JS every refresh_ms to get latest data."""
        return self.kvs.get_all()

    def get_config(self) -> dict:
        """Return full YAML config to JS for layout/palette rendering."""
        return self.config

    def save_layout(self, layout: list) -> dict:
        """Persist layout changes from D&D to YAML."""
        self.config["layout"] = layout
        try:
            with open(self.config_path, "w") as f:
                yaml.dump(self.config, f, allow_unicode=True,
                          default_flow_style=False, sort_keys=False)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_palette(self) -> list:
        return self.config.get("palette", [])


# ============================================================
# Static file HTTP server (serves public/ to pywebview)
# ============================================================

class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler that suppresses access logs."""
    def log_message(self, format, *args):
        pass

def start_static_server(public_dir: str) -> int:
    """Start a background HTTP server for static files. Returns the port."""
    handler = partial(_QuietHandler, directory=public_dir)
    server = http.server.HTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return port


# ============================================================
# Main
# ============================================================

def main():
    base_dir = Path(__file__).parent.resolve()
    config_path = base_dir / "config" / "dashboard.yaml"
    public_dir = str(base_dir / "public")

    # Load config
    with open(config_path) as f:
        config = yaml.safe_load(f)

    meta = config.get("meta", {})
    title = meta.get("title", "PerfMon")
    subtitle = meta.get("subtitle", "")

    # Initialize KVS and collector engine
    profile = "--profile" in sys.argv
    kvs = KVS(history_size=60)
    engine = CollectorEngine(kvs, config, profile=profile)
    engine.start()

    if profile:
        print("[profile] Profiling enabled - collector costs printed every 5 cycles")

    # Start static file server
    port = start_static_server(public_dir)
    url = f"http://127.0.0.1:{port}/index.html"

    # Create pywebview window
    import webview

    api = PerfMonApi(kvs, str(config_path), config)

    window = webview.create_window(
        f"{title} - {socket.gethostname()} - {subtitle}",
        url=url,
        js_api=api,
        width=1440,
        height=920,
        min_size=(900, 600),
        background_color="#0b1120",
    )

    webview.start(debug="--debug" in sys.argv)
    engine.running = False


if __name__ == "__main__":
    main()
