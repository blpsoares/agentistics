# 16 — Sandbox feasibility: what a native agent harness can actually promise

Date of research: 2026-09-20. Probe machine: WSL2 (Ubuntu 22.04) on Windows, kernel
`5.15.167.4-microsoft-standard-WSL2`, Docker Engine 29.3.0 (native-in-WSL, not Docker Desktop).

Context: `docs/superpowers/specs/2026-09-20-runtime-b3-tool-catalogue.md` §D-T3/§7/D-T5 says OS
sandboxing must be opt-in, real where it exists, and never advertised where it is not. This
document establishes what "where it exists" means in concrete, measured terms, for a **single Bun
binary that cannot ship native modules**.

---

## PART 1 — What the competitors do (public docs, dated)

### OpenAI Codex CLI — the strongest built-in default, and the one exception to "opt-in"

Codex is the only major CLI agent that sandboxes **by default**, not opt-in. Per-platform:

- **macOS**: `sandbox-exec` with a Seatbelt profile matched to the selected sandbox mode.
  ([Codex Knowledge Base, 2026-04-08](https://codex.danielvaughan.com/2026/04/08/codex-sandbox-platform-implementation/))
- **Linux**: **Landlock** (LSM) restricts filesystem access; **seccomp-BPF** restricts network by
  blocking `connect`/`accept`/`bind`/`listen`/`sendto`/`sendmsg` (AF_UNIX exempted, so local IPC
  still works); **bubblewrap** (`bwrap`) provides the namespace layer when Landlock is
  unavailable/insufficient. Source: `codex-rs/linux-sandbox/src/landlock.rs`
  ([github.com/openai/codex](https://github.com/openai/codex/blob/main/codex-rs/linux-sandbox/src/landlock.rs), checked 2026-09-20;
  summarized in [Codex Knowledge Base, 2026-04-08](https://codex.danielvaughan.com/2026/04/08/codex-sandbox-platform-implementation/)).
- **Windows** (experimental as of March 2026): three execution modes — native PowerShell
  elevated, native PowerShell unelevated, or WSL2 (which just uses the Linux path above). The
  **native** Windows sandbox composes existing OS primitives rather than a kernel driver:
  `CreateProcessAsUser` with a **restricted token** (stripped privileges + added "deny" SIDs),
  **synthetic SIDs** placed in both the token's `RestrictedSids` and target ACLs (so the check is
  "is this SID present," not "does a real principal own this"), filesystem boundaries via those
  ACLs, and — in the elevated tier only — dedicated low-privilege sandbox user accounts plus
  Windows Firewall rules for network containment; the unelevated tier has no firewall control and
  falls back to environment-level "offline" flags instead.
  ([OpenAI, "Building a safe, effective sandbox to enable Codex on Windows," undated 2026](https://openai.com/index/building-codex-windows-sandbox/);
  [Codex Knowledge Base, 2026-05-14](https://codex.danielvaughan.com/2026/05/14/codex-cli-windows-sandbox-engineering-restricted-tokens-acls-elevated-architecture/);
  [Codex Knowledge Base, 2026-07-18](https://codex.danielvaughan.com/2026/07/18/codex-cli-windows-sandbox-architecture-powershell-ast-safety-elevated-unelevated-appcontainer-restricted-tokens/))
- **Documented failure mode that matters directly to us**:
  [openai/codex#1039](https://github.com/openai/codex/issues/1039) — "The combination of
  seccomp/landlock that Codex uses for sandboxing is not supported in this environment," reported
  specifically under WSL, intermittently. OpenAI's own guidance in the thread is to sandbox the
  **Docker container** instead and run Codex with approvals disabled inside it — i.e., their own
  team's answer to "Landlock doesn't reliably work here" is "use a different layer," not "we'll
  patch it." This is corroborating, independent evidence for our own measurement below: Landlock's
  *syscall* can answer while the *tool built on top of it* still refuses to trust the environment.

### Gemini CLI — opt-in, widest mechanism menu, explicitly not a default

Off by default; enabled via `GEMINI_SANDBOX=true|docker|podman|sandbox-exec` or `settings.json`.
Menu: **macOS Seatbelt** (five named profiles from `permissive-open` to `restrictive-closed`,
selected via `SEATBELT_PROFILE`), **Linux bubblewrap** (unprivileged namespaces + seccomp),
**Docker/Podman** (custom image via `GEMINI_SANDBOX_IMAGE`, extra flags via `SANDBOX_FLAGS`),
plus mentions of **gVisor (runsc)** and **LXC/LXD** for stronger container isolation.
([google-gemini.github.io/gemini-cli, "Sandboxing in the Gemini CLI," checked 2026-09-20](https://google-gemini.github.io/gemini-cli/docs/cli/sandbox.html);
mirrored at [geminicli.com/docs/cli/sandbox](https://geminicli.com/docs/cli/sandbox/))

### GitHub Copilot CLI — MXC, shell-only, opt-in until mid-2026, then shipped standard

Built on **Microsoft eXecution Container (MXC)**, a cross-platform library that picks a
per-platform OS backend behind one policy interface:
**Seatbelt on macOS** (needs macOS 15 Sequoia+, one process-scoped profile per sandboxed command),
**Bubblewrap on Linux** (needs `bwrap` ≥0.5.0 on `PATH` — Copilot does not vendor it),
**ProcessContainer/BaseContainer on Windows** (Insiders builds only at time of writing; if the
Windows build cannot supply BaseContainer, Copilot CLI reports sandboxing unsupported rather than
degrading silently). It sandboxes **shell commands, built-in search, and local MCP/LSP server
child processes** — not the whole agent process. Shipped as part of the standard Copilot CLI seat
starting June 2026.
([GitHub Docs, "About cloud and local sandboxes for GitHub Copilot," checked 2026-09-20](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes);
[microsoft/mxc README + policy.md](https://github.com/microsoft/mxc/blob/main/docs/sandbox-policy/0.7.0/policy.md), checked 2026-09-20)

### Sculptor (Imbue) / OpenCode — the two ends of "not a native sandbox"

- **Sculptor**: doesn't attempt OS-level sandboxing at all — it clones the repo into a **fresh
  Docker container** per agent (from the user's own devcontainer spec) and treats the container
  boundary as the whole isolation story; explicitly positioned against git worktrees ("share your
  local environment") as the thing that keeps the host machine safe.
  ([imbue.com/blog/containers, undated 2026](https://imbue.com/blog/containers); [imbue.com/blog/sculptor](https://imbue.com/blog/sculptor))
- **OpenCode**: ships **no sandbox** — its permission-prompt system is explicitly a UX
  confirmation layer, not a security boundary. The maintainers' own recommendation for real
  isolation is "run it inside Docker or a VM yourself." Third-party plugins exist that bolt on
  Seatbelt/bubblewrap or a Docker network with egress firewalling, but these are community add-ons,
  not the product's own claim.
  ([github.com/anomalyco/opencode issue #12674, opened Feb 2026](https://github.com/anomalyco/opencode/issues/12674);
  [dev.to/uenyioha, "Building Sandboxes into OpenCode," 2026](https://dev.to/uenyioha/building-sandboxes-into-opencode-if-you-give-an-llm-a-shell-you-lose-part-2-4f5o))

**Reading across all five**: nobody but Codex enables anything by default; every mechanism used
anywhere (Seatbelt, bubblewrap, Landlock, seccomp, ProcessContainer, restricted tokens) is a
composition of OS primitives that already ship in the kernel/OS — none of them require a custom
kernel module or driver; and the one case that looks like "real containment" without composing
those primitives (Sculptor) simply moves the whole problem into Docker and calls that the boundary.

---

## PART 2 — What is available HERE (measured, read-only, nothing persisted)

Machine: WSL2, kernel `5.15.167.4-microsoft-standard-WSL2`, Ubuntu 22.04 userspace, ext4 root,
Docker Engine 29.3.0 running natively inside the WSL2 instance (not Docker Desktop passthrough).

### Landlock

```
$ cat /sys/kernel/security/lsm
Error: No such file or directory        # securityfs isn't mounted in this WSL2 image
$ zcat /proc/config.gz | grep -E "SECCOMP|LANDLOCK|USER_NS"
CONFIG_NAMESPACES=y
CONFIG_USER_NS=y
CONFIG_SECCOMP=y
CONFIG_SECCOMP_FILTER=y
CONFIG_SECURITY_LANDLOCK=y
```

The `/sys/kernel/security/lsm` listing being absent is a **red herring** — it only means
securityfs isn't mounted in this WSL2 image, not that the LSM is disabled. Landlock doesn't need
securityfs; it's invoked purely through syscalls. Direct syscall probe (`landlock_create_ruleset`
with the `LANDLOCK_CREATE_RULESET_VERSION` flag, which only queries the ABI and creates nothing):

```python
libc.syscall(444, None, 0, 1)   # SYS_landlock_create_ruleset, VERSION flag
# → ret = 1, errno = 0
```

**Landlock ABI v1 is genuinely usable on this kernel.** ABI v1 (the version this 5.15 kernel
implements) covers filesystem access control only (read/write/execute per path) — no network
control; that arrived in ABI v4 (kernel 6.7+), well past this machine's 5.15. So on this exact
machine, "Landlock" means **filesystem-only**, and network egress control would have to come from
seccomp-BPF instead (exactly the split Codex's own Linux implementation makes).

**Caveat that must be stated honestly**: [openai/codex#1039](https://github.com/openai/codex/issues/1039)
shows Codex's own Landlock+seccomp combination failing at runtime on some WSL2 setups even though
the raw syscall answers, intermittently and not fully explained upstream. A raw ABI probe proves
the primitive exists; it does not prove every consumer's exact ruleset construction will be
accepted on every WSL2 kernel build. Treat "Landlock is available" here as **true but fragile**,
not as a green light to skip a runtime self-test before relying on it.

### bubblewrap / unshare / user namespaces / seccomp

```
$ which bwrap          → not found
$ apt-cache policy bubblewrap
  Installed: (none)
  Candidate: 0.6.1-1ubuntu0.3     # available in the distro's own repos, not installed
$ which unshare        → /usr/bin/unshare (util-linux 2.37.2), present
$ unshare --user --pid --net --mount --fork --map-root-user echo ok
  → "namespaces ok", exit 0
$ unshare --user --map-root-user --mount bash -c 'mount -t tmpfs tmpfs /mnt'
  → mount_rc=0
$ cat /proc/sys/kernel/unprivileged_userns_clone   → file doesn't exist (this sysctl is a
  Debian/Ubuntu desktop kernel patch; its absence here means user namespaces are simply
  unconditionally allowed, not that they're blocked — confirmed by the successful unshare above)
$ cat /proc/sys/user/max_user_namespaces   → 47834 (plenty of headroom)
$ python3 -c "libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)"   → rc = 0
```

**Unprivileged user namespaces, mount namespaces, and `no_new_privs`/seccomp all work as the
ordinary logged-in user, with no `sudo`.** `bwrap` itself isn't installed, but everything it needs
(unprivileged userns + mount + seccomp) is demonstrably functional, and the package is one
`apt install bubblewrap` away from the distro's own repos — this is exactly the "Linux uses
bwrap+seccomp by default" story Codex/Gemini/Copilot all rely on, minus the binary itself.

### Docker / Podman

```
$ docker version   → Client & Server both present, Docker Engine 29.3.0, containerd 2.2.1
$ podman            → not found
$ docker run --rm --memory=64m --cpus=0.5 --read-only --network=none alpine:latest \
    sh -c 'echo ok; cat /proc/self/status | grep -i seccomp; id'
  → docker-sandbox-ok
    Seccomp: 2                (SECCOMP_MODE_FILTER)
    Seccomp_filters: 1
    uid=0(root) inside container  # mapped, not the host uid
```

Docker is fully usable, runs its default seccomp profile, and honors `--memory`, `--cpus`,
`--read-only`, `--network=none` — a real, currently-working container boundary on this machine,
with no user setup beyond having Docker Engine installed (which it already is, for `agentop
central`/`docker/machine.yml`). Podman is absent and not part of this product's existing surface.

### cgroups v2

```
$ mount | grep cgroup   → cgroup2 on /sys/fs/cgroup (nsdelegate)
$ cat /sys/fs/cgroup/cgroup.controllers   → cpuset cpu io memory hugetlb pids rdma misc
$ cat /sys/fs/cgroup/cgroup.subtree_control   → cpuset cpu io memory pids
```

cgroups v2 is mounted with `nsdelegate` and the controllers a memory/CPU limiter would need
(`memory`, `cpu`, `pids`) are already active in `subtree_control` at the root. Whether an
**unprivileged** process can create and delegate its own subtree here without root was not
separately re-verified with a live write (a real cgroup delegation setup normally needs systemd's
`--user` slice or a one-time root-owned delegation) — treat cgroup-based limiting as
"kernel-ready, needs a privileged one-time setup step or Docker as the vehicle," not as something
a bare unprivileged Bun process can arrange for itself from nothing.

### ulimit / setrlimit

```
$ ulimit -a
  core file size: 0        open files: 1,048,576      max processes: 47,834
  data/mem/virtual/cpu/file size: all "unlimited" at the shell level
```

`setrlimit` works everywhere, always, with zero privilege and zero kernel feature dependency — but
it is a **per-process resource ceiling** (file descriptors, process count, CPU seconds, address
space, core dumps), not an isolation boundary. It cannot stop a process from reading `~/.ssh`,
reaching the network, or running `rm -rf /important-dir`. It is the one thing that is *always*
available, on every platform this product supports, from Bun's own `child_process` spawn options,
with no OS feature probing required.

### `/mnt/c` vs. the Linux filesystem

`/mnt/c` is mounted via the `9p` protocol (`aname=drvfs`, `msize=65536`) — a **network-filesystem-like**
transport into the Windows NTFS volume, not a native Linux filesystem. This matters for sandboxing
in two ways: (1) Landlock and bind-mount-based restrictions operate on inodes/paths and work
identically across both mounts as far as the LSM is concerned, but (2) a `9p` mount's actual
permission enforcement ultimately depends on Windows ACLs surfaced through `drvfs`, not native
POSIX permissions — so a Landlock rule that says "no write access below this path" is enforced by
Linux's LSM hook regardless of backing filesystem, but a sandbox that instead relies on **changing
Unix file modes/ownership** as its containment (chattr, chmod 000, a dedicated uid) is materially
weaker on `/mnt/c`, because those bits are synthesized by `drvfs` and don't carry the same
guarantees NTFS ACLs would if set directly. **Practical takeaway for this product**: prefer
Landlock/seccomp/namespace-based restriction (kernel-enforced, filesystem-transport-independent)
over uid/chmod-based restriction for any repo that might live under `/mnt/c`; and if a repo is
under `/mnt/c`, a container (Docker) sandbox is strictly the safer choice since it fully
virtualizes the path anyway.

---

## PART 3 — The answer for the product

### Table: mechanism × platform × what it restricts × availability here × Bun-binary cost

| Platform | Mechanism | Filesystem | Network | Process | Resources | Available here | Cost in a native-module-free Bun binary |
|---|---|---|---|---|---|---|---|
| Linux (native/WSL2) | **Landlock** | Yes, per-path allow/deny | No (ABI v1, this kernel) | No | No | **Yes** — ABI v1 confirmed live | Needs raw `syscall()` (444/445/446) with hand-built ruleset structs; Bun's FFI (`bun:ffi`) can call raw syscalls without a native module, but the ruleset-building logic must be hand-written (no landlock crate available in JS); real but nontrivial glue code |
| Linux (native/WSL2) | **seccomp-BPF** | No | Yes, syscall-level (block connect/bind/etc.) | Partial (blocks syscalls, not exec of new binaries) | No | **Yes** — kernel config confirms `CONFIG_SECCOMP_FILTER=y`; `prctl(NO_NEW_PRIVS)` succeeded | Needs a hand-assembled BPF program via `prctl(PR_SET_SECCOMP)`; no native module, but real low-level work — this is the hardest of the four to get right and easiest to get subtly wrong (must exempt AF_UNIX etc., as Codex's does) |
| Linux (native/WSL2) | **bubblewrap** | Yes (namespaces + bind mounts) | Yes (network namespace can be left unjoined) | Yes (pid namespace) | Partial (via cgroups it drives) | **Available as a package, not installed**; unprivileged userns+mount confirmed functional | Zero glue code if shipped as a **spawned external binary** (`bwrap` on PATH) rather than linked — this is exactly how Codex/Gemini/Copilot all use it; the product would `spawn('bwrap', [...])`, no FFI needed, but it is an **external dependency the user must have installed** |
| Linux (native/WSL2) | **Docker** | Yes (full container fs) | Yes (`--network=none` or custom) | Yes (full pid ns) | Yes (`--memory`/`--cpus`) | **Yes, confirmed working**, incl. seccomp default profile, `--read-only`, `--network=none` | Zero glue code — spawn `docker run` as a subprocess; the strongest, easiest-to-implement option, at the cost of requiring Docker installed and a multi-second cold start per session unless images are pre-warmed |
| Linux (native/WSL2) | **cgroups v2** | No | No | No | Yes (mem/cpu/pids) | Controllers active in `subtree_control`; unprivileged delegation not separately proven | Writing cgroup files is trivial I/O, no native module — but creating/delegating a subtree as a plain user typically needs a one-time privileged setup (systemd user slice) the product cannot silently arrange |
| Linux (native/WSL2) | **ulimit/setrlimit** | No | No | No (partial: fd/proc caps) | Yes (always) | **Yes, unconditionally** | Free — `Bun.spawn`'s options / Node's `child_process` expose rlimits with zero native code |
| macOS | **Seatbelt** (`sandbox-exec`) | Yes | Yes | Partial | No | Not this machine (WSL2) — but `sandbox-exec` is a system binary present on every stock macOS | Zero glue code to *invoke* (spawn `sandbox-exec -p '<profile>' cmd`), but the **Seatbelt profile language itself must be authored and validated by hand** — undocumented, Apple-deprecated API surface every competitor still uses because there's no replacement |
| Windows (native) | **Restricted tokens + ACLs + synthetic SIDs (+Firewall in elevated mode)** | Yes (ACL-based) | Yes (elevated tier only, via Firewall rules) | Partial (token strip) | No | Not this machine | Substantial: this is Win32 API surface (`CreateProcessAsUser`, token manipulation) with **no pure-JS or Bun FFI-friendly path** — realistically needs a small companion native helper or shelling out to PowerShell/`icacls`, which is exactly the "cannot ship native modules" wall; Codex and Copilot both built dedicated engineering effort around this on Windows for months |
| Windows (WSL2) | *(same as Linux, run inside WSL2)* | — | — | — | — | This machine, is Linux path | Same as Linux row — but note WSL2 is what this whole Part 2 probe already covers |

### The honest floor — what is real when no sandbox mechanism is available at all

When none of Landlock, seccomp, bubblewrap, Docker, or a platform-native sandbox can be assumed
(the actual floor on an arbitrary user's machine the product cannot pre-verify), what's left:

1. **The permission layer itself** — the approval gate this product already has (asking before a
   command runs, before a file outside the project is touched). This is a **process control**, not
   an OS boundary: it stops nothing an approved command decides to do, and stops nothing at all if
   the agent's own reasoning is what's compromised (a prompt-injected agent that talks its way past
   the approval prompt, or an approved `npm install` that runs a malicious postinstall script).
2. **A separate OS user/uid running the agent** — real, ordinary POSIX permission enforcement, but
   only as strong as whatever that uid can already reach; it does nothing against reading the
   project's own files (which the agent needs to do its job) or against network egress.
3. **`ulimit`/`setrlimit`** — always available, stops resource exhaustion (fork bombs, disk-filling
   loops, too many open files) but nothing about *what* the process reads, writes, or contacts.
4. **A read-only bind mount of everything the agent shouldn't touch** — real and kernel-enforced
   the instant it's in place, but it is not automatic: something (the product, or the user) has to
   set it up per-directory, and a plain unprivileged process cannot silently arrange arbitrary bind
   mounts against paths it doesn't own without at least the mount-namespace layer (`unshare
   --mount`) — which brings us back to "namespaces available" being the actual precondition.
5. **A container the user explicitly opts into** (Docker, as this machine already has, or a VM) —
   the one mechanism on this list that is a **complete** boundary (filesystem, network, process,
   resources all at once) rather than a partial one, and the only one requiring nothing more exotic
   than "the user already has Docker" to get maximum coverage.

**What an agent can still do with only the floor (1)+(3) in place, no OS sandbox at all**: read and
exfiltrate any file the invoking user's account can read (source trees, SSH keys, cloud
credentials, browser cookie stores, `.env` files anywhere on the filesystem, not just the project);
make arbitrary outbound network connections; install and execute arbitrary further code (via a
package manager, a downloaded script, a compiler); modify or delete files outside the project
directory; consume unlimited disk (the one thing `setrlimit` narrows is fd/process counts, not disk
space by default). None of this requires malice from the model — a single over-broad shell command
the approval prompt didn't catch, or a compromised dependency install, is enough. This is not a
hypothetical: it is the literal permission surface of "a program running as your own user account,"
which is what an agent harness is, absent a sandbox.

### What the product must never claim, and the exact UI wording

**Never claim, imply, or render**:
- A green shield / lock / "protected" badge when no OS-level mechanism is actually active for that
  session — the repo's own N/A-vs-confident-0 rule applies here at least as strongly as anywhere
  else in the codebase, because the cost of being wrong is a compromised machine, not a wrong
  number on a chart.
- "Sandboxed" as a single word with no scope — every real mechanism above restricts *some*
  dimensions and not others (Landlock: no network; seccomp alone: no filesystem; Docker: all four
  but requires Docker; a separate uid: nothing beyond ordinary Unix permissions). A claim that
  doesn't name which dimensions are covered is a claim nothing here can back.
- Any wording implying protection against a **malicious or compromised model/dependency** when the
  actual mechanism only limits accidental over-broad commands approved by habit (the difference
  between "stops you from fat-fingering `rm -rf ~`" and "stops a prompt-injected agent from
  exfiltrating your SSH key").

**Recommended exact wording, matching the repo's own N/A convention** (`HARNESS_CAPABILITIES`,
`liveEmptyNotice`, `LiveUnavailableReason` are the precedent — a reason code renders one already-
localized sentence, never a bare boolean):

- No sandbox available/enabled for this session:
  *"No sandbox on this session — commands run with your own account's full file and network
  access. The approval prompts are the only gate."*
- Landlock/seccomp active (Linux, filesystem-only, this machine's actual ceiling):
  *"Filesystem sandbox active (Landlock) — writes outside the project are blocked. Network access
  and the project's own files are not restricted."*
- Full container sandbox (Docker):
  *"Running in an isolated container — filesystem, network, and resources are contained. Changes
  only reach your machine if you bring them out."*
- A mechanism that was requested but the environment can't provide (mirroring
  `LiveUnavailableReason`'s reason codes: `no-landlock`, `no-bwrap`, `no-docker`, `unsupported-os`):
  *"Sandbox requested but unavailable here: [reason, in words — e.g. 'bubblewrap is not installed']. Running without it."*

Each of these is a **fact about this session on this machine**, never a static claim baked into
marketing copy — exactly the same discipline `central-runtime.ts` and `HARNESS_CAPABILITIES`
already apply to "can this feature work here," applied to sandboxing instead of a metric.

### Recommendation: v1 vs. later

**v1 (ship now, cheap, honest)**:
1. `ulimit`/`setrlimit` on every spawned agent process, unconditionally — free, no platform
   detection needed, closes the resource-exhaustion gap with zero cost.
2. A **capability probe** (mirroring `central-runtime.ts`'s `available` + reason-code pattern) run
   once per machine at startup: does `bwrap` exist on PATH? Does `docker` respond? Does
   `landlock_create_ruleset` answer with a usable ABI version (via a small `bun:ffi` syscall probe,
   not a native module)? Cache the answer, surface it in Settings exactly like
   `HARNESS_CAPABILITIES` surfaces harness gaps.
3. **Docker as the opt-in "real" sandbox**, offered wherever Docker is already detected (this
   product already ships `docker/machine.yml` and detects Docker elsewhere) — spawn `docker run`
   with `--read-only`, `--network=none` (or a scoped network), `--memory`, `--cpus`, mounting only
   the project directory read-write and nothing else. This is the one mechanism on the table that
   is a **complete** boundary and needs zero new native code — it is entirely `child_process.spawn`
   composing an existing tool, exactly the shape every other subprocess integration in this
   codebase already takes (central.sh, tmux, git).
4. **Never claim a sandbox is on** unless the probe in (2) actually confirmed the mechanism
   answered on this machine, this session — no assuming a mechanism from the OS name alone (macOS
   ships `sandbox-exec` on every install, but a corporate MDM profile can still disable it; a Linux
   distro can ship a 5.4 kernel with `CONFIG_SECCOMP` off).

**Later (real engineering investment, sequence by cost)**:
5. **bubblewrap integration on Linux/WSL2**, spawned as an external binary (not linked) — covers
   the gap between "no sandbox" and "full Docker," for users who don't have or don't want Docker
   running. Requires the product to either bundle/require `bwrap` as an optional dependency (like
   it already treats `tmux`) or degrade cleanly to the floor when absent.
6. **A hand-built Landlock ruleset via `bun:ffi` raw syscalls**, filesystem-only, as a *lighter*
   Linux option than bubblewrap for the common case of "just don't let it write outside the
   project" — real engineering (BPF/ruleset construction has no JS library to lean on) but bounded
   in scope, and it is the one mechanism that needs neither an external binary nor a container.
7. **macOS Seatbelt profile authoring** — spawn `sandbox-exec` (zero glue), but budget real time to
   write and validate a profile against Apple's underdocumented, officially-deprecated-but-still-
   only-option syntax; every competitor researched here (Codex, Gemini, Copilot) had to do the same
   work independently, which says this is a genuine cost center, not a shortcut anyone found.
8. **Windows native sandboxing** — put last on purpose. It is real Win32 API surface (restricted
   tokens, ACLs, synthetic SIDs, optionally Firewall rules) with **no FFI-friendly path** for a
   Bun binary without native modules; Codex and Copilot both spent months of dedicated engineering
   on this exact wall. Until then, the honest v1 story for a Windows-native (non-WSL2) user is the
   same as any environment with nothing available: the permission layer, `setrlimit`s where
   Windows equivalents exist, and pointing them at Docker Desktop or WSL2 if they want real
   containment — stated as such, not silently upgraded to a claim the platform can't back.
