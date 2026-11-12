# Astra Pro 2.0 SDK build input

`astra_grpc_clients-2.0.0-py3-none-any.whl` is the unmodified wheel supplied with the manufacturer's Astra Pro gRPC interface archive. It is a permanent, checksum-pinned build dependency. Generated environments, downloads, logs and reports must remain outside the checkout.

The original wheel's `METADATA` is preserved here. It identifies Astra Robotics HB-Wtio as author and declares the MIT license classifier. The supplied wheel contains no separate license or copyright notice; no additional vendor attribution has been invented. Obtain the manufacturer's complete license notice for future public redistribution if available. The build preserves the original metadata, this notice, and all licenses shipped by Python and dependency wheels.

The slim control runtime keeps the supplied wheel unchanged and imports its generated `proto_python` modules directly. It includes gRPC, the protobuf compiler and their dependencies, but deliberately omits both OpenCV distributions and NumPy. Taught actions, status, speech and stop RPCs do not use camera helpers. Importing the top-level `astra_grpc_clients` camera wrapper is unsupported in this profile because it eagerly imports `cv2` and NumPy.

The SDK's original dependency metadata remains intact. Validation permits exactly its two missing OpenCV requirements and rejects every other dependency error; it also asserts that `cv2` and NumPy are unavailable and exercises the bridge through real loopback RPCs. A plain `pip check` therefore reports those two intentional omissions. Do not run a dependency-resolving SDK reinstall inside this runtime: that would add the excluded vision stack again.
