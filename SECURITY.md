# Security Policy

## Supported Versions

We actively provide security patches for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0.0 | :x:                |

## Reporting a Vulnerability

The Nook team takes the security of autonomous agent execution, sandboxing, and user privacy very seriously. Because Nook provides agents with sandboxed computers, browser profiles, and shell capabilities, security safeguards and human-in-the-loop review policies are paramount.

If you believe you have found a security vulnerability in Nook:
1. **Do not** report security vulnerabilities via public GitHub issues.
2. Please report the issue privately by emailing security disclosures or submitting a confidential security advisory through GitHub's Security Advisory feature.
3. Include detailed steps to reproduce the issue, along with any relevant proof-of-concept scripts or logs.

### Response Time
- We acknowledge receipt of vulnerability reports within 48 hours.
- We aim to provide an assessment and resolution plan within 7 business days.
- Public credit will be awarded to researchers once the advisory is coordinated and published.

## Container Isolation & Docker-in-Docker (DinD) Trust Boundary

In the default `docker-compose.yml` production topology:
- **`nook-app` (Web Tier)** and **`nook-worker` (Dedicated Worker Tier)** run as unprivileged `nextjs:nodejs` (UID 1001) without access to `/var/run/docker.sock`.
- **`nook-sandbox-runner`** communicates with **`nook-container-supervisor`** (`docker:27-dind`) over an internal-only Docker network (`sandbox_internal`) to spawn short-lived, network-isolated (`--network none`), capability-dropped (`--cap-drop ALL`), read-only rootfs task containers.
- **Privileged DinD Boundary**: Because `docker:27-dind` requires `privileged: true` to manage nested container namespaces on standard Linux hosts, `nook-container-supervisor` holds root-equivalent host kernel capabilities. While task containers are isolated from the supervisor's control plane and cannot reach `tcp://container-supervisor:2375`, operators deploying Nook in high-assurance or untrusted multi-tenant environments should run the container supervisor inside a dedicated VM boundary or substitute a rootless/microVM runtime (e.g., Sysbox, gVisor `runsc`, or Kata Containers).
- **Network Binding**: By default, `docker-compose.yml` binds the web port to `127.0.0.1:3000:3000` (`${NOOK_BIND_ADDRESS:-127.0.0.1}:3000:3000`). Place a TLS-terminating reverse proxy in front of Nook before exposing it to external networks, and run `npm run doctor` prior to launch to verify secret entropy and configuration posture.
