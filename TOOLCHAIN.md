# ZKaaS Toolchain Reference

## Version Pins

| Tool | Version | Source |
|---|---|---|
| nargo | 1.0.0-beta.9 | `noirup -v 1.0.0-beta.9` |
| bb (barretenberg) | 0.87.0 | `bbup -v 0.87.0` |
| soroban-sdk | 22.0.0 | crates.io |
| stellar-cli | 25.2.0 | already installed on host |
| Rust | stable | rust-toolchain.toml |
| Node | 22.14.0 | already installed on host |

> If actual installed versions differ from the pins above, reality wins. Document the discrepancy here and update the circuits/contract accordingly.

---

## WSL2 Workflow

Circuits live in the Windows repo. Compile them from WSL2 — do NOT duplicate the file tree.

```
# From WSL2 Ubuntu-24.04:
cd /mnt/c/Users/eric/Desktop/HACKATON

# Compile a circuit
cd circuits/poseidon_preimage
nargo compile

# Generate witness (replaces deprecated nargo prove --input)
nargo execute witness

# Generate UltraHonk proof + VK
bb prove -b target/poseidon_preimage.json -w target/witness.gz -o target/
bb write_vk -b target/poseidon_preimage.json -o target/

# Run nargo tests
nargo test
```

---

## Phase 0 Installation (WSL2 Ubuntu-24.04)

```bash
# 1. Install Rust (required for bb)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# 2. Install noirup + nargo 1.0.0-beta.9
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
source "$HOME/.bashrc"
noirup --version 1.0.0-beta.9

# Verify
nargo --version  # must print: nargo version = 1.0.0-beta.9

# 3. Install bbup + bb 0.87.0
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
source "$HOME/.bashrc"
bbup --version 0.87.0

# Verify
bb --version  # must print: 0.87.0

# 4. Install stellar-cli (optional — already installed on host; use host binary if needed)
cargo install --locked stellar-cli --version 25.2.0
```

---

## Phase 0 Exit Criterion

Clone and run rs-soroban-ultrahonk until a UltraHonk proof is verified on Stellar testnet:

```bash
# WSL2
git clone https://github.com/yugocabrio/rs-soroban-ultrahonk
cd rs-soroban-ultrahonk

# Build WASM verifier contract
cargo build --target wasm32-unknown-unknown --release

# Deploy to testnet (adjust contract name from repo README)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/<verifier>.wasm \
  --source <ADMIN_KEYPAIR> \
  --network testnet

# Run the example / invoke verify()
# → success criterion: transaction returns verified = true
```

Document the actual contract ID here once deployed:
```
ULTRAHONK_EXAMPLE_CONTRACT_ID=<paste after Phase 0>
```

---

## Architecture Correction (Critical)

**The README originally stated `soroban_sdk::host::verify_ultrahonk(...)` as a host function. This does NOT exist in soroban-sdk.**

### Reality

UltraHonk on-chain verification uses the **`ultrahonk_soroban_verifier` crate** from [rs-soroban-ultrahonk](https://github.com/yugocabrio/rs-soroban-ultrahonk).

The crate uses these **real** Soroban host functions (Protocol 25 / CAP-0074):

| Host function | Purpose |
|---|---|
| `env.crypto().bn254_g1_msm(...)` | BN254 multi-scalar multiplication |
| `env.crypto().bn254_g1_add(...)` | BN254 G1 point addition |
| `env.crypto().bn254_pairing(...)` | BN254 pairing check |
| `env.crypto().keccak256(...)` | Keccak-256 hash (transcript) |

The crate compiles to WASM and runs inside Soroban. Callers invoke `verify(env, proof, public_inputs, vk)` (exact API TBC after Phase 0 inspection of the crate source).

### Poseidon

Poseidon is used **off-chain** in Noir circuits only. There is no Poseidon host function in soroban-sdk 22. The `bn254::hash_1` / `bn254::hash_2` functions in Noir's standard library are BN254 Poseidon.

---

## Circuit Compilation Commands

```bash
# poseidon_preimage (Phase 1)
cd /mnt/c/Users/eric/Desktop/HACKATON/circuits/poseidon_preimage
nargo compile
echo "1234567890" > Prover.toml  # replace with real secret
nargo execute witness
bb prove -b target/poseidon_preimage.json -w target/witness.gz -o target/proof
bb write_vk -b target/poseidon_preimage.json -o target/vk

# Encode for API call:
# proof: base64(target/proof/proof)
# vk:   base64(target/vk/vk)
```

---

## Environment Variables (ZKaaS)

```env
# Soroban
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ZK_VERIFIER_CONTRACT_ID=<deployed contract ID>
ADMIN_SECRET_KEY=<Stellar secret key for admin ops>

# x402 mock mode (dev only — NEVER in production)
X402_MOCK_MODE=true
```

---

## Known Version Incompatibilities / Toolchain Reality

- **nargo >= 1.0.0-beta.1**: `nargo prove` no longer exists. Use `nargo execute <witness_name>` + `bb prove`.
- **soroban-sdk 26.0.1**: rs-soroban-ultrahonk uses 26.0.1 (not 22.x as the spec assumed).
- **Mixed sdk versions in workspace**: zk-verifier uses its own `[dependencies]` (not workspace-inherited). Other contracts remain on 21.7.6.
- **wasm32v1-none target**: rs-soroban-ultrahonk uses `wasm32v1-none`, NOT `wasm32-unknown-unknown`. Run: `rustup target add wasm32v1-none`.
- **std::hash::poseidon::bn254 NOT EXPORTED** in nargo 1.0.0-beta.9: The `poseidon` module is private. Circuits use `std::hash::pedersen_hash` instead (BN254-native).
- **bb needs jq**: `bb prove` and `bb write_vk` invoke `jq` externally. Install: `sudo apt-get install -y jq`.
- **bb and NTFS**: Proof generation fails from `/mnt/c/...`. Copy artifacts to Linux FS first, then run bb, then copy back.
- **PROOF_BYTES = 14592**: UltraHonk proofs = 456 x 32 bytes. Confirmed against `PROOF_FIELDS = 456` in ultrahonk_soroban_verifier.
- **Non-ASCII in Noir comments**: nargo 1.0.0-beta.9 rejects non-ASCII in comments. Use ASCII only.
- **bb verify public inputs path**: `bb verify` hardcodes `./target/public_inputs`. Run from the directory that contains `target/public_inputs`.
- **UltraHonkVerifier API**: `UltraHonkVerifier::new(&env, &vk_bytes)?` then `verifier.verify(&env, &proof_bytes, &public_inputs)?`. Both take `Bytes`, NOT Vec<BytesN<32>>.

## Phase 0 Results

- nargo 1.0.0-beta.9: installed at `~/.nargo/bin/nargo` in WSL2
- bb 0.87.0: installed at `~/.bb/bb` in WSL2
- poseidon_preimage circuit: compiled + 2 nargo tests pass + proof 14592 bytes + **locally verified**
- reputation_v1 circuit: compiled + 4 nargo tests pass
- PROOF_BYTES = 14592 confirmed (matches ultrahonk_soroban_verifier::PROOF_BYTES)
- On-chain verification: pending — deploy rs-soroban-ultrahonk to testnet
