"""Exercise the real SDK and bridge on loopback only, using the bundled interpreter.

Executed via `python -I -B -c <source> <runtime-root>` so script directories,
user site-packages and inherited PYTHONPATH cannot satisfy missing dependencies.
"""

from concurrent.futures import ThreadPoolExecutor
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import grpc
import grpc_tools.protoc
from google.protobuf.message_factory import GetMessageClass
from proto_python import astra_service_pb2 as messages
from proto_python import astra_service_pb2_grpc as services


def check_slim_dependencies():
    """Reject dependency errors other than the SDK's deliberately omitted vision packages."""
    for module in ("cv2", "numpy"):
        assert importlib.util.find_spec(module) is None, f"Unexpected slim dependency: {module}"
    expected = {f"astra-grpc-clients 2.0.0 requires {name}, which is not installed."
                for name in ("opencv-python", "opencv-contrib-python")}
    result = subprocess.run([sys.executable, "-I", "-B", "-m", "pip", "--isolated",
                             "--disable-pip-version-check", "check"],
                            text=True, capture_output=True, timeout=30, check=False)
    assert result.returncode == 1 and set(result.stdout.splitlines()) == expected, (
        result.returncode, result.stdout, result.stderr)
    return sorted(expected)


def main():
    root = Path(sys.argv[1]).resolve()
    manifest = json.loads((root / "manifest.json").read_text())
    assert manifest["profile"] == "slim"
    assert sys.version.split()[0] == manifest["pythonVersion"]
    assert Path(sys.prefix).resolve().is_relative_to(root)
    for module in (grpc, grpc_tools.protoc, messages, services):
        assert Path(module.__file__).resolve().is_relative_to(root), module.__name__
    assert importlib.metadata.version("astra-grpc-clients") == "2.0.0"
    omitted_requirements = check_slim_dependencies()
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
    print(json.dumps({"python": sys.version.split()[0], "profile": "slim", "sdkProtocolImport": True,
                      "visionDependenciesAbsent": True, "expectedMissingRequirements": omitted_requirements,
                      "loopbackOperations": ["status", "single", "group", "speech", "three-stops"],
                      "isolated": bool(sys.flags.isolated), "distributions": distributions}, indent=2))


if __name__ == "__main__":
    main()
