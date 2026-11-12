# Astra Pro 2.0 SDK build input

`astra_grpc_clients-2.0.0-py3-none-any.whl` is the unmodified wheel supplied with the manufacturer's Astra Pro gRPC interface archive. It is a permanent, checksum-pinned build dependency. Generated environments, downloads, logs and reports must remain outside the checkout.

The original wheel's `METADATA` is preserved here. It identifies Astra Robotics HB-Wtio as author and declares the MIT license classifier. The supplied wheel contains no separate license or copyright notice; no additional vendor attribution has been invented. Obtain the manufacturer's complete license notice for future public redistribution if available. The build preserves the original metadata, this notice, and all licenses shipped by Python and dependency wheels.

The full runtime contains both OpenCV packages required by the vendor, plus NumPy, gRPC, the protobuf compiler and their dependencies. Both OpenCV distributions write the same `cv2` namespace; installation deliberately finishes with the contrib wheel, then checks the contrib API and dependency metadata. Size accounting counts actual files once.
