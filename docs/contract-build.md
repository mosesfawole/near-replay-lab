# Contract build and behavior

The Rust workspace produces two **constructed testnet fixtures**, `unsafe-vault` and `guarded-vault`, using `near-sdk` exactly `5.30.0`. Their shared JSON interface is [fixture-interface.md](fixture-interface.md). They hold native NEAR funded separately on their own accounts. A worker key's function-call allowance pays for gas; it does not limit the fixture's native-token spending.

## Toolchain

Use Rust `1.97.1` with `wasm32-unknown-unknown`, Cargo, `cargo-near` `0.22.0`, a native C/C++ toolchain, OpenSSL development headers, and Binaryen `wasm-opt`. `near-sdk` `5.30.0` requires Rust at least `1.95`. On this Windows host, builds and tests run inside WSL; Windows has no native linker configured for these tests.

The task-local toolchain is initialized in:

```text
C:\Users\normie\Documents\Codex\2026-11-02\files-pasted-by-the-user-role\work\wsl-toolchain\env.sh
```

The following are complete PowerShell commands from any working directory on this host. They source that toolchain and use a shared build cache outside the repository.

```powershell
wsl.exe -e bash -lc 'source /mnt/c/Users/normie/Documents/Codex/2026-11-02/files-pasted-by-the-user-role/work/wsl-toolchain/env.sh; export CARGO_TARGET_DIR="$near_tool_root/target"; cd /mnt/c/Users/normie/Documents/Codex/2026-11-02/files-pasted-by-the-user-role/outputs/near-replay-lab; cargo test --locked'

wsl.exe -e bash -lc 'source /mnt/c/Users/normie/Documents/Codex/2026-11-02/files-pasted-by-the-user-role/work/wsl-toolchain/env.sh; export CARGO_TARGET_DIR="$near_tool_root/target"; cd /mnt/c/Users/normie/Documents/Codex/2026-11-02/files-pasted-by-the-user-role/outputs/near-replay-lab; cargo fmt --all -- --check'

wsl.exe -e bash -lc 'source /mnt/c/Users/normie/Documents/Codex/2026-11-02/files-pasted-by-the-user-role/work/wsl-toolchain/env.sh; export CARGO_TARGET_DIR="$near_tool_root/target-wasm"; cd /mnt/c/Users/normie/Documents/Codex/2026-11-02/files-pasted-by-the-user-role/outputs/near-replay-lab; cargo near build non-reproducible-wasm --locked --no-abi --manifest-path contracts/unsafe-vault/Cargo.toml --out-dir /mnt/c/Users/normie/Documents/Codex/2026-11-02/files-pasted-by-the-user-role/outputs/near-replay-lab/res'

wsl.exe -e bash -lc 'source /mnt/c/Users/normie/Documents/Codex/2026-11-02/files-pasted-by-the-user-role/work/wsl-toolchain/env.sh; export CARGO_TARGET_DIR="$near_tool_root/target-wasm"; cd /mnt/c/Users/normie/Documents/Codex/2026-11-02/files-pasted-by-the-user-role/outputs/near-replay-lab; cargo near build non-reproducible-wasm --locked --no-abi --manifest-path contracts/guarded-vault/Cargo.toml --out-dir /mnt/c/Users/normie/Documents/Codex/2026-11-02/files-pasted-by-the-user-role/outputs/near-replay-lab/res'
```

In a separately prepared Linux/WSL environment with these tool versions on `PATH`, the repository-relative equivalents are:

```bash
cargo test --locked
cargo fmt --all -- --check
cargo near build non-reproducible-wasm --locked --no-abi --manifest-path contracts/unsafe-vault/Cargo.toml --out-dir "$PWD/res"
cargo near build non-reproducible-wasm --locked --no-abi --manifest-path contracts/guarded-vault/Cargo.toml --out-dir "$PWD/res"
```

`cargo-near` supplies the required NEAR Wasm configuration and runs the optimizer. Do not supply Wasm `RUSTFLAGS` to host tests. `--locked` pins the committed dependency resolution; `non-reproducible-wasm` describes the local build mode and does not claim a container-reproducible build.

The deployable outputs are `res/unsafe_vault.wasm` and `res/guarded_vault.wasm` under the repository. Build commands do not deploy contracts or access credentials.

## Fixture bounds and deliberate differences

Initialization accepts one owner, 1–16 distinct configured worker public keys, 1–16 distinct allowed recipients, and a positive per-payment cap. Each fixture accepts at most 256 canonical approvals; identifiers must contain 1–128 UTF-8 bytes. These fixed bounds keep this disposable experiment's state predictable. Approvals cannot be replaced or deleted. Canonical approval amounts must also fit the configured payment cap.

Every payment requires both the owner's account as predecessor and a configured transaction signing public key. It rejects an attached deposit, missing approval, expiry at or before the current block timestamp, an unallowed recipient, zero amount, or an amount exceeding the cap. Expiry and amount are integer strings in JSON.

The guarded fixture additionally requires the canonical recipient and exact amount, accepts only `Approved` or proven `Failed`, increments its attempt ID, and writes `Pending` before constructing the native transfer and private callback. A matching successful raw promise result sets `Paid`, increments the completed count, and records the canonical recipient/amount. A matching failed result sets `Failed`, allowing a subsequent worker request before expiry. A missing, inconsistent, or panicking callback leaves the obligation `Pending`. Callback completion can arrive after expiry because the original claim was checked before sending.

The unsafe fixture deliberately omits the exact obligation binding and the Pending/Paid claim gate. A permitted request always schedules its requested native transfer and increments the attempt ID. Its callback accepts any issued attempt so that successful concurrent callbacks all increment the completed count, including callbacks older than the latest attempt. Its status follows the latest processed callback and does not establish whether other requests are outstanding. Callback counts do not prevent another settlement. These omissions are the constructed recipient-substitution and duplicate-payment behaviors that the comparison suite demonstrates.

Both callbacks are private, inspect `env::promise_result(0)`, and require exactly one raw result; callers cannot supply a success flag. Both record integer completion counts and the last completed transfer's exact fields. The guarded callback also requires the current Pending attempt and exact canonical detail. An owner approval does not reserve funds; an insufficient vault balance can still produce a real failed transfer.

The SDK deprecates unbounded `promise_result` reads for generic contract-call return data. A narrow annotation preserves the explicit raw `PromiseResult` match here because each callback's sole dependency is a native transfer, which returns an empty payload. The fixture does not schedule arbitrary contract-call results through this callback.

## Evidence limit

Host tests exercise real contract methods against the NEAR SDK's mocked host environment, inspect the resulting scheduled transfer and callback actions, and supply raw success/failure results. They establish local state and permission behavior. They do not execute receipts on a live chain or prove a recipient was credited. The testnet runner must establish finalized native transfer receipts, dedicated recipient balance changes, and final approval views independently. Neither fixture is a production vault or a claim about a vendor vulnerability.
