# 🔒 Security Policy

Security matters at Flixer. As a self-hosted media platform, Flixer handles user accounts, server configuration, API credentials, and access to personal media libraries. We appreciate responsible reports that help protect everyone running or contributing to Flixer.

## 🛡️ Supported Versions

Flixer is under active development. Security fixes are generally targeted at the latest available release and the current development branch.

| Version | Security support |
| --- | --- |
| Latest published release | ✅ Targeted for security fixes |
| Current `main` branch | ✅ Security fixes during development |
| Older releases and commits | ⚠️ Not guaranteed |
| Unofficial forks or modified builds | ❌ Not maintained by the Flixer team |

This table describes the project's intended support policy, not a guarantee of fixes or response times. Users should keep Flixer and its components up to date.

## 🚨 Reporting a Vulnerability

**Please do not disclose a suspected vulnerability in a public GitHub issue, pull request, discussion, or community chat.**

To report a vulnerability affecting this repository, use [Flixer's GitHub Security Advisories](https://github.com/flixermedia/flixer/security/advisories) and select **Report a vulnerability** if private vulnerability reporting is enabled.

If private reporting is not available, open a public issue **without any exploit details or sensitive information** to request a private contact method from the maintainers. Do not attach a proof of concept to that issue.

Please include, where possible:

- **Summary:** What the vulnerability is and why it matters.
- **Affected component:** API/backend, authentication, setup wizard, database, web client, streamer, indexer, installer, or another component.
- **Affected version:** Release, image tag, or commit hash; include whether the installation is Docker-based.
- **Impact:** What an attacker might be able to access, change, or disrupt.
- **Reproduction:** Clear, minimal steps using a test system and non-sensitive data.
- **Evidence:** Sanitized logs, screenshots, or proof-of-concept material submitted privately.
- **Mitigations:** Any known workarounds or configuration changes.

**Never include real passwords, API keys, passkeys, tokens, recovery codes, or other people's personal data in a report.**

### Related repositories

Flixer consists of multiple components maintained under the [FlixerMedia organization](https://github.com/flixermedia). When a flaw is isolated to a separate repository, report it privately through that repository's security reporting channel, if available. For vulnerabilities spanning components, begin with the [core Flixer security advisories](https://github.com/flixermedia/flixer/security/advisories) and identify every affected component.

## 🤝 Coordinated Disclosure

We ask security researchers to:

- Report suspected vulnerabilities privately before publishing details.
- Give maintainers a reasonable opportunity to investigate, develop a fix, and coordinate disclosure.
- Avoid accessing, altering, or deleting other people's data.
- Avoid disrupting installations, overwhelming services, or testing systems without authorization.
- Limit testing to systems you own or have explicit permission to assess.
- Avoid sharing working exploits publicly before affected users have a reasonable opportunity to update.

Maintainers will aim to review reports, assess their impact, work on an appropriate mitigation, and coordinate publication of an advisory where warranted. **No fixed acknowledgment or remediation deadline is guaranteed.** Disclosure timing will depend on severity, exploitability, and fix availability.

Reporter credit may be included in public advisories with the reporter's consent.

This policy does not establish a paid bug bounty program or provide legal authorization to test third-party systems.

## 🔍 Areas of Particular Interest

Security issues may involve, but are not limited to:

- Authentication, account recovery, passkeys, session handling, and privilege escalation.
- Administrator-only actions, authorization checks, and access to other users' data.
- API endpoints, input validation, injection, request forgery, and cross-site scripting.
- Streaming authorization, media access controls, and file or path traversal.
- Library scanning, filesystem permissions, and network share handling.
- Setup and recovery flows, configuration storage, encryption keys, and secrets handling.
- Docker images, installation scripts, dependencies, and update mechanisms.
- Inter-service communication between the API, web client, streamer, and indexer.

An issue should have a plausible security impact. General bugs, feature requests, and non-security performance issues belong in [GitHub Issues](https://github.com/flixermedia/flixer/issues).

## 🏠 Security Guidance for Self-Hosted Installations

Flixer administrators are responsible for securing their own hosts and deployments. We recommend:

1. **Update regularly.** Use supported Flixer images and keep the host, Docker, and other dependencies patched.
2. **Protect public access.** Use HTTPS and a correctly configured reverse proxy when exposing Flixer beyond a trusted local network.
3. **Protect credentials.** Keep `.env` files, API keys, database credentials, passkey-related settings, and recovery information private. Never commit them to source control.
4. **Restrict access.** Apply least-privilege permissions to media directories, mounted network shares, and persistent data.
5. **Limit exposed services.** Do not publish internal databases, Redis, or management interfaces to untrusted networks unless explicitly required and securely configured.
6. **Review customizations.** Audit unofficial plugins, modified builds, scripts, and third-party integrations before using them.
7. **Back up securely.** Protect backups and the associated configuration and encryption key material, and test restoration procedures.
8. **Monitor your deployment.** Review logs for suspicious authentication attempts and unexpected configuration changes, while keeping sensitive information out of shared logs.

These recommendations reduce risk but cannot guarantee that an installation is secure.

## 📢 Security Updates

When appropriate, confirmed vulnerabilities and available fixes may be documented through [GitHub Security Advisories](https://github.com/flixermedia/flixer/security/advisories), release notes, or repository announcements. Users should review security notices and update affected components promptly.

---

**Thank you for helping keep Flixer and its community secure.** 🔒
