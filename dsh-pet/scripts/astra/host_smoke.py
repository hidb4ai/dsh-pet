"""Verify the installed HTTP host automatically starts its bundled SDK worker.

Only a synthetic loopback status service is exposed. No motion is requested.
The test runs from the installed private interpreter and writes outside the repo.
"""

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import grpc
from google.protobuf.message_factory import GetMessageClass
from proto_python import astra_service_pb2 as messages


def main():
    package, output = (Path(arg).resolve() for arg in sys.argv[1:3])
    grpc_server = grpc.server(ThreadPoolExecutor(max_workers=8))
    for service_name in ["ActionControlService", "StateService"]:
        service = messages.DESCRIPTOR.services_by_name[service_name]
        handlers = {}
        for method in service.methods:
            if not method.name.startswith("Get"):
                continue
            response_class = GetMessageClass(method.output_type)

            def respond(request, context, response_class=response_class):
                response = response_class()
                for field, value in [("state_code", 520000), ("description", "Bundled host probe"), ("mode", 1)]:
                    if field in response.DESCRIPTOR.fields_by_name:
                        setattr(response, field, value)
                return response

            handlers[method.name] = grpc.unary_unary_rpc_method_handler(
                respond, request_deserializer=GetMessageClass(method.input_type).FromString,
                response_serializer=response_class.SerializeToString)
        grpc_server.add_generic_rpc_handlers((grpc.method_handlers_generic_handler(service.full_name, handlers),))
    port = grpc_server.add_insecure_port("127.0.0.1:0")
    grpc_server.start()
    if len(sys.argv) > 3:
        try:
            subprocess.run([shutil.which("node"), sys.argv[3], str(package), f"127.0.0.1:{port}", str(output)],
                           check=True, timeout=120)
        finally:
            grpc_server.stop(0).wait()
        return
    home = output / "host-home"
    (home / "dsh-pet").mkdir(parents=True)
    (home / "dsh-pet/main-config.jsonc").write_text(json.dumps({"pets": [{"id": "main", "display": "none"}]}))
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        http_port = listener.getsockname()[1]
    environment = {**os.environ, "DSH_HOME": str(home), "BROWSER": "true", "DISPLAY": "",
                   "PYTHONHOME": str(output / "nonexistent-python"), "PYTHONPATH": str(output)}
    host = None
    try:
        with (output / "host-smoke.log").open("w", encoding="utf-8") as log:
            host = subprocess.Popen([shutil.which("node"), str(package / "lib/standalone.js"),
                                     "--port", str(http_port)], env=environment, stdout=log, stderr=log)
            state_file = home / "dsh-pet/standalone-runtime.json"
            for _ in range(150):
                if state_file.exists():
                    break
                if host.poll() is not None:
                    raise RuntimeError("Installed host exited; inspect host-smoke.log")
                time.sleep(0.1)
            token = json.loads(state_file.read_text())["token"]

            def request(body=None):
                req = urllib.request.Request(
                    f"http://127.0.0.1:{http_port}/dsh-pet-7340/robot",
                    data=json.dumps(body).encode() if body is not None else None,
                    headers={"Content-Type": "application/json", "X-DSH-Pet-Token": token})
                with urllib.request.urlopen(req, timeout=20) as response:
                    return json.load(response)

            initial = request()
            assert not initial["config"]["enabled"]
            assert initial["config"]["python"] == "bundled"
            config = {**initial["config"], "enabled": True, "address": f"127.0.0.1:{port}"}
            assert request({"action": "configure", "config": config})["ok"]
            for _ in range(40):
                snapshot = request({"action": "check"})
                if snapshot["connected"]:
                    break
                time.sleep(0.25)
            assert snapshot["connected"], snapshot
            assert snapshot["telemetry"]["description"] == "Bundled host probe"
            assert not snapshot["armed"] and not snapshot["commands"]
            print("Installed host -> bundled Python -> SDK -> loopback status: passed")
    finally:
        if host is not None:
            host.terminate()
            try:
                host.wait(timeout=15)
            except subprocess.TimeoutExpired:
                host.kill()
                host.wait()
        grpc_server.stop(0).wait()


if __name__ == "__main__":
    main()
