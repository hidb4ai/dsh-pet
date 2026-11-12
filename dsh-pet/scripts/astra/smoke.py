"""Exercise the real SDK and bridge on loopback only, using the bundled interpreter.

Executed via `python -I -B -c <source> <runtime-root>` so script directories,
user site-packages and inherited PYTHONPATH cannot satisfy missing dependencies.
"""

from concurrent.futures import ThreadPoolExecutor
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys

import astra_grpc_clients
import cv2
import grpc
import grpc_tools.protoc
import numpy
from google.protobuf.message_factory import GetMessageClass
from proto_python import astra_service_pb2 as messages


def main():
    root = Path(sys.argv[1]).resolve()
    manifest = json.loads((root / "manifest.json").read_text())
    assert sys.version.split()[0] == manifest["pythonVersion"]
    assert Path(sys.prefix).resolve().is_relative_to(root)
    for module in (astra_grpc_clients, cv2, grpc, numpy):
        assert Path(module.__file__).resolve().is_relative_to(root), module.__name__
    assert cv2.__version__ == "4.10.0" and hasattr(cv2, "aruco")
    assert importlib.metadata.version("astra-grpc-clients") == "2.0.0"
    assert numpy.dot([1, 2], [3, 4]) == 11
    encoded, _ = cv2.imencode(".png", numpy.zeros((2, 2, 3), dtype=numpy.uint8))
    assert encoded
    calls = []

    def handler(method):
        response_class = GetMessageClass(method.output_type)

        def respond(request, context):
            calls.append((method.name, request))
            response = response_class()
            for field, value in (("state_code", 520000), ("description", "Loopback idle"),
                                 ("mode", 1), ("success", True), ("result_description", "Accepted")):
                if field in response.DESCRIPTOR.fields_by_name:
                    setattr(response, field, value)
            return response
        return grpc.unary_unary_rpc_method_handler(
            respond, request_deserializer=GetMessageClass(method.input_type).FromString,
            response_serializer=response_class.SerializeToString)

    server = grpc.server(ThreadPoolExecutor(max_workers=8))
    for service in messages.DESCRIPTOR.services_by_name.values():
        server.add_generic_rpc_handlers((grpc.method_handlers_generic_handler(
            service.full_name, {method.name: handler(method) for method in service.methods
                                if not method.client_streaming and not method.server_streaming}),))
    port = server.add_insecure_port("127.0.0.1:0")
    assert port > 0
    server.start()
    try:
        for operation, extra in [("status", {}), ("execute", {"actionIds": [7]}),
                                 ("execute", {"actionIds": [7, 8]}),
                                 ("speak", {"text": "Loopback test"}), ("stop", {})]:
            request = {"operation": operation, "address": f"127.0.0.1:{port}",
                       "timeoutSeconds": 3, "requestId": "bundle-smoke", **extra}
            result = subprocess.run([sys.executable, "-I", "-B", "-c", (root / "bridge.py").read_text()],
                                    input=json.dumps(request), text=True, capture_output=True, timeout=15, check=True)
            reply = json.loads(result.stdout)
            assert reply["ok"], reply
            if operation == "status":
                assert reply["telemetry"] == {"actionCode": 520000, "description": "Loopback idle", "modes": [1, 1, 1]}
            if operation == "stop":
                assert len(reply["stops"]) == 3
        grouped = {name: request for name, request in calls}
        assert grouped["ActionControl"].action_id == 7
        assert list(grouped["ActionManager"].action_id) == [7, 8]
        assert grouped["PublishTTSText"].tts_text == "Loopback test"
        assert grouped["RobotSetMode"].mode == 5
        assert "PlannerControlStop" in grouped and "AgvEmergencyStop" in grouped
    finally:
        server.stop(0).wait()
    versions = {dist.metadata["Name"]: dist.version for dist in importlib.metadata.distributions()}
    distributions = [{"name": name, "version": version} for name, version in sorted(versions.items())]
    print(json.dumps({"python": sys.version.split()[0], "sdkImport": True, "opencvContrib": True,
                      "loopbackOperations": ["status", "single", "group", "speech", "three-stops"],
                      "isolated": bool(sys.flags.isolated), "distributions": distributions}, indent=2))


if __name__ == "__main__":
    main()
