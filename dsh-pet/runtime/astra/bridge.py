"""Run one Astra Pro 2.0 RPC using the manufacturer's generated Python SDK.

The host supplies a validated request on stdin. Each RPC has a deadline;
timeouts and cancellation never imply that physical movement has stopped.
"""

import concurrent.futures
import importlib.metadata
import json
import sys


def reply(ok, code, message, **fields):
    """Build a bounded response for the host process."""
    return {"ok": ok, "code": code, "message": str(message)[:1000], **fields}


def load_sdk():
    """Load only the 2.0 protocol modules; camera/OpenCV helpers are unnecessary."""
    if importlib.metadata.version("astra-grpc-clients") != "2.0.0":
        raise RuntimeError("Install the manufacturer-provided astra-grpc-clients 2.0.0 wheel.")
    import grpc
    from proto_python import astra_service_pb2 as messages
    from proto_python import astra_service_pb2_grpc as services
    return grpc, messages, services


def read_status(channel, messages, services, timeout):
    """Read controller state and automatic-mode flags concurrently."""
    action = services.ActionControlServiceStub(channel)
    state = services.StateServiceStub(channel)
    calls = [
        (action.GetActionControllerStateCode, messages.StateCodeRequest()),
        (action.GetActionControllerStateDescription, messages.StateDescriptionRequest()),
        (state.GetBodyMode, messages.ArmModeRequest()),
        (state.GetLeftArmMode, messages.ArmModeRequest()),
        (state.GetRightArmMode, messages.ArmModeRequest()),
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = [pool.submit(method, request, timeout=timeout) for method, request in calls]
        values = [future.result() for future in futures]
    return reply(True, "status", "Controller state received.", telemetry={
        "actionCode": values[0].state_code,
        "description": values[1].description[:500],
        "modes": [value.mode for value in values[2:]],
    })


def stop_robot(channel, messages, services, timeout):
    """Attempt planner, upper-body and AGV stops independently, retaining each result."""
    calls = {
        "planner": (services.PlannerControlServiceStub(channel).PlannerControlStop, messages.TriggerRequest()),
        "upperBody": (services.SetModeServiceStub(channel).RobotSetMode, messages.SetModeRequest(mode=5)),
        "agv": (services.AgvServiceStub(channel).AgvEmergencyStop, messages.TriggerRequest()),
    }

    def attempt(method, request):
        try:
            result = method(request, timeout=timeout)
            return {"ok": bool(result.success), "message": str(getattr(result, "message", ""))[:500]}
        except Exception:
            return {"ok": False, "message": "Stop request was not acknowledged; check the robot locally."}

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        pending = {name: pool.submit(attempt, *call) for name, call in calls.items()}
        stops = {name: future.result() for name, future in pending.items()}
    ok = all(result["ok"] for result in stops.values())
    return reply(ok, "stop_acknowledged" if ok else "stop_unconfirmed",
                 "Stop responses received; verify the robot is stationary." if ok else
                 "One or more stops are unconfirmed. Use the physical emergency stop if needed.", stops=stops)


def execute(channel, messages, services, request):
    """Dispatch only pre-taught action IDs; direct motion planning is not exposed."""
    action_ids = request["actionIds"]
    timeout = request["timeoutSeconds"]
    if len(action_ids) == 1:
        method = services.ActionControlServiceStub(channel).ActionControl
        result = method(messages.ActionControlRequest(action_id=action_ids[0], command_id=request["requestId"]), timeout=timeout)
    else:
        method = services.ActionManagerServiceStub(channel).ActionManager
        result = method(messages.ActionManagerRequest(action_id=action_ids, command_description=request["requestId"]), timeout=timeout)
    return reply(bool(result.success), "reported_success" if result.success else "rejected", result.result_description)


def run(request, sdk=None):
    """Return a structured result; a lost response remains an uncertain command."""
    try:
        grpc, messages, services = sdk or load_sdk()
    except (ImportError, importlib.metadata.PackageNotFoundError, RuntimeError) as error:
        return reply(False, "sdk_unavailable", f"Astra SDK 2.0.0 is unavailable or incompatible: {error}")
    try:
        timeout = request["timeoutSeconds"]
        with grpc.insecure_channel(request["address"]) as channel:
            operation = request["operation"]
            if operation == "status":
                return read_status(channel, messages, services, timeout)
            if operation == "stop":
                return stop_robot(channel, messages, services, timeout)
            if operation == "execute":
                return execute(channel, messages, services, request)
            if operation == "speak":
                services.VoiceServiceStub(channel).PublishTTSText(messages.TTSTextRequest(tts_text=request["text"]), timeout=timeout)
                return reply(True, "reported_success", "Speech request accepted; playback completion is not confirmed.")
            return reply(False, "invalid_request", "Unsupported robot operation.")
    except grpc.RpcError as error:
        return reply(False, "rpc_error", f"RPC {error.code().name}; execution state must be checked before retrying.")
    except Exception:
        return reply(False, "adapter_error", "The robot adapter failed; execution state is unknown.")


def main():
    """Read one host request without executing attachment demo programs."""
    try:
        request = json.loads(sys.stdin.read(16_384))
        result = run(request)
    except (ValueError, TypeError):
        result = reply(False, "invalid_request", "Invalid adapter request.")
    print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
