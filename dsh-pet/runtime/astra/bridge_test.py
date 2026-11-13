"""Offline checks for SDK call selection, deadlines and independent stop failures."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("astra_bridge", Path(__file__).with_name("bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class Messages:
    def __getattr__(self, _name):
        return lambda **fields: SimpleNamespace(**fields)


class Channel:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class RpcError(Exception):
    def code(self):
        return SimpleNamespace(name="DEADLINE_EXCEEDED")


class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.failures = set()
        self.grpc = SimpleNamespace(insecure_channel=lambda _address: Channel(), RpcError=RpcError)
        self.messages = Messages()

        def method(name):
            def call(request, *, timeout):
                self.calls.append((name, request, timeout))
                if name in self.failures:
                    raise RpcError()
                return SimpleNamespace(success=True, result_description="controller success", message="ack",
                                       state_code=520000, description="idle", mode=1)
            return call

        def stub(*names):
            return lambda _channel: SimpleNamespace(**{name: method(name) for name in names})

        self.services = SimpleNamespace(
            ActionControlServiceStub=stub("ActionControl", "GetActionControllerStateCode", "GetActionControllerStateDescription"),
            ActionManagerServiceStub=stub("ActionManager"),
            PlannerControlServiceStub=stub("PlannerControlStop"),
            SetModeServiceStub=stub("RobotSetMode"),
            AgvServiceStub=stub("AgvEmergencyStop"),
            VoiceServiceStub=stub("PublishTTSText"),
            StateServiceStub=stub("GetBodyMode", "GetLeftArmMode", "GetRightArmMode"),
        )

    def request(self, operation, **values):
        return bridge.run({"operation": operation, "address": "127.0.0.1:50051", "timeoutSeconds": 3, **values},
                          (self.grpc, self.messages, self.services))

    def test_one_action_uses_action_control_with_named_response_fields(self):
        result = self.request("execute", actionIds=[100], requestId="request-1")
        self.assertTrue(result["ok"])
        name, request, timeout = self.calls[0]
        self.assertEqual(name, "ActionControl")
        self.assertEqual(request.action_id, 100)
        self.assertEqual(request.command_id, "request-1")
        self.assertEqual(timeout, 3)
        self.assertEqual(result["message"], "controller success")

    def test_action_sequence_uses_version_two_action_manager(self):
        self.request("execute", actionIds=[100, 101], requestId="request-2")
        name, request, _timeout = self.calls[0]
        self.assertEqual(name, "ActionManager")
        self.assertEqual(request.action_id, [100, 101])
        self.assertEqual(request.command_description, "request-2")

    def test_rpc_timeout_is_uncertain_and_never_retried(self):
        self.failures.add("ActionControl")
        result = self.request("execute", actionIds=[100], requestId="request-3")
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "rpc_error")
        self.assertEqual(len(self.calls), 1)

    def test_stop_attempts_all_subsystems_even_if_one_fails(self):
        self.failures.add("PlannerControlStop")
        result = self.request("stop")
        self.assertFalse(result["ok"])
        self.assertFalse(result["stops"]["planner"]["ok"])
        self.assertTrue(result["stops"]["agv"]["ok"])
        self.assertEqual({name for name, _, _ in self.calls}, {"PlannerControlStop", "RobotSetMode", "AgvEmergencyStop"})
        self.assertEqual(next(request.mode for name, request, _ in self.calls if name == "RobotSetMode"), 5)

    def test_read_only_status_has_deadlines_and_does_not_change_control_mode(self):
        result = self.request("status")
        self.assertEqual(result["telemetry"]["modes"], [1, 1, 1])
        self.assertTrue(all(name.startswith("Get") and timeout == 3 for name, _, timeout in self.calls))

    def test_speech_uses_robot_tts(self):
        self.request("speak", text="Hello")
        self.assertEqual(self.calls[0][0], "PublishTTSText")
        self.assertEqual(self.calls[0][1].tts_text, "Hello")

    def test_arbitrary_system_commands_are_not_exposed(self):
        self.assertFalse(self.request("execute_system_command")["ok"])
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
