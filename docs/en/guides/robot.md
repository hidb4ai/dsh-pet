# Connect an Astra Pro 2.0 robot

[Documentation](../README.md) · [简体中文](../../zh/guides/robot.md)

For a first installation, follow the [complete setup and interaction tutorial](../tutorials/astra-first-interaction.md).

This feature is in the development source and is **not included in the published `0.1.0-beta.1` package**. Use a build containing the robot bridge. The control panel is shared by DSH pet chat and standalone pet chat; PowerContext and a model API key are not required for robot controls.

## What works

| Operator action | Astra Pro 2.0 interface | Pet feedback |
| --- | --- | --- |
| Check connection | Controller state code/description and body/left/right arm modes | Connection and controller description |
| Run a taught action | `ActionControl(action_id, command_id)` | Requested action, optional pet animation and result receipt |
| Run a taught sequence | `ActionManager(action_id[], command_description)` | One group request and result receipt |
| Speak through the robot | `PublishTTSText(tts_text)` | Request acknowledgement; playback completion is unknown |
| Stop robot | `PlannerControlStop`, `RobotSetMode(mode=5)`, `AgvEmergencyStop` | A separate acknowledgement for each subsystem |

Monitoring polls controller state every five seconds while enabled. A changed controller description produces a pet bubble, including changes initiated outside the pet. The SDK status used here does not identify the externally performed action: it cannot yet mirror arbitrary robot gestures. An optional pet animation starts when this application requests its mapped action; it is not synchronized to physical completion.

Ordinary chat, automatic whispers and model output do not dispatch robot movement. This first integration uses explicit operator buttons and an allowlist of manufacturer-verified, pre-taught action IDs. It does not expose joint control, Cartesian motion, mode recovery or arbitrary SDK/system commands. Robot commands are not automatically stored as PowerContext memories.

## Prepare the host and robot

Ask the manufacturer for the exhibition robot's **2.0 gRPC address and port**, validated taught action IDs and sequence order, required initial posture/modes, and the on-site recovery procedure after a stop. Do not copy example IP addresses or action IDs from demonstration files.

The Python interpreter runs on the machine hosting DSH or the standalone app, which must reach the robot. For DSH in a container, install Python/SDK inside that environment and configure a path visible there. The manufacturer SDK uses plaintext gRPC; keep it on the controlled robot network. The DSH host access controls apply to robot control as well; standalone uses its existing local session authentication.

For the recommended bundled installation, download the [slim control package](robot-bundles.md) for your host platform and select **Bundled environment**. It includes private Python and the SDK control dependencies, without OpenCV or NumPy and without modifying system Python.

For an explicit custom environment, install the supplied `astra_grpc_clients-2.0.0-py3-none-any.whl` into a separate Python environment **outside the repository and application directory**. Python 3.11 or 3.12 is a suitable starting point. The generated SDK requires newer dependencies than the wheel's minimum metadata; the following versions were verified together against a local gRPC test service.

Linux (replace the wheel path with your actual download):

```bash
python3 -m venv "$HOME/.local/share/astra-v2-venv"
"$HOME/.local/share/astra-v2-venv/bin/python" -m pip install \
  "grpcio==1.78.0" "protobuf==6.31.1" \
  /path/to/astra_grpc_clients-2.0.0-py3-none-any.whl
```

Windows PowerShell:

```powershell
$astraVenv = Join-Path $env:LOCALAPPDATA "astra-v2-venv"
py -3.11 -m venv $astraVenv
& "$astraVenv\Scripts\python.exe" -m pip install `
  "grpcio==1.78.0" "protobuf==6.31.1" `
  "C:\Downloads\astra_grpc_clients-2.0.0-py3-none-any.whl"
```

The ordinary plugin ships only the adapter; the slim platform artifacts additionally include private Python and the SDK control dependencies. Camera and image processing helpers are excluded. The adapter imports the generated protocol modules directly and applies deadlines to every call. It only accepts SDK version `2.0.0`; it does not fall back to the 1.0 protocol. Windows commands are setup instructions; this integration has not been validated on a physical Windows-connected robot.

## Configure and operate

1. Open pet chat and expand **Astra Pro 2.0 robot → Connection and taught actions**.
2. Enter the robot's `hostname:port` or IPv4 address and port. Keep **Bundled environment** for a full package, or select **Custom Python environment** and enter its full executable path. IPv6 addresses are not currently supported.
3. Add a descriptive action name and the approved action ID. Comma-separated IDs send one 2.0 action-manager sequence, in order. Optional pet animation names must match the installed pet's animation configuration.
4. Enable connection monitoring and save. Saving or restarting the host disarms motion. Checking a connection never changes the robot's mode or moves it.
5. Choose **Check connection**. Motion authorization requires a fresh status, idle controller code `520000`, and body/left/right arm modes all equal to automatic mode `1`. Set the robot's modes using the manufacturer's tooling; this UI never switches it into automatic mode.
6. With the robot stationary and the action cleared on site, choose **Verified stationary on site: allow one action**, then **Run selected physical action**. Authorization is consumed by the request, including a failed or uncertain result.
7. For speech, type the text and choose **Speak through robot**. Speech requires a connection and an idle application command slot, but no movement authorization.
8. Use **Recent requests** to inspect the outcome. `Controller reported success` is the RPC result, not independent evidence that movement finished. A timeout or connection loss is `Execution state unknown`; the app never automatically retries it.

**Stop robot** stays available while an action request is pending. It starts an independent adapter process and attempts all three subsystem stops even if one fails. Cancelling the local request is not evidence that the robot stopped. Confirm standstill on site and use the physical emergency stop when required. Resuming modes is an on-site operation; the application does not automatically resume. Closing the host attempts a stop only when an application command is still pending; it cannot guarantee a stop after a crash or a power/network loss.

## Stored state and troubleshooting

- `$DSH_HOME/dsh-pet/astra-robot.json`: connection and action allowlist, with private file permissions. Without `DSH_HOME`, the host's normal DSH data directory applies.
- `$DSH_HOME/dsh-pet/astra-commands.json`: up to 20 recent receipts, trimmed further to fit the private file size limit. Speech text is not stored in these receipts. Vendor response messages may contain operational details.
- Host restarts retain uncertain receipts but never replay commands. Session IDs change on restart/configuration changes. Duplicate command IDs with identical contents return the existing receipt; conflicting contents are rejected. Request IDs are application deduplication keys, not a claim of robot-side exactly-once execution.
- `bundled_runtime_unavailable`: install the full package for this host platform; a missing bundled runtime never falls back to system Python.
- `sdk_unavailable`: check the configured interpreter, exact SDK version and pinned gRPC/protobuf dependencies.
- `robot_not_ready`: check connection freshness, idle code and all three modes. A successful ping alone is insufficient.
- `robot_storage_unavailable`: fix permissions or a corrupt private state file while control is stopped, then restart. Movement stays blocked; a stop request remains available when the configured address was loaded.
- `robot_receipt_limit`: the controller retains at most 1,000 request identities per host session. After confirming no active movement, restart the host to begin a new session.

## Validation boundary

Automated checks cover one-shot authorization, duplicate requests, stale status, restart uncertainty, independent stops and the actual browser controls. The supplied 2.0 wheel has also been exercised against a **synthetic loopback gRPC server**, including the built HTTP host and Python process bridge. This verifies serialization and application behavior; it does not validate robot firmware, physical movements, collision avoidance, speech playback, or stopping distance. Those require the exhibition robot and an on-site operator.

For developers: `pnpm test`, `pnpm test:robot` (Python, no SDK needed), and `pnpm test:ui`. Local environments, protocol probes and validation logs belong outside the checkout. See the [HTTP reference](../reference/http-api.md) and [OpenAPI contract](../../../openapi.yaml).
