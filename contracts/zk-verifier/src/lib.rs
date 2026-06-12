#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Bytes, Env, Map, Symbol,
};
use ultrahonk_soroban_verifier::{UltraHonkVerifier, VkLoadError};

const ADMIN_KEY: Symbol = symbol_short!("ADMIN");
const VK_MAP_KEY: Symbol = symbol_short!("VK_MAP");
const ROOT_KEY: Symbol = symbol_short!("REP_ROOT");

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    UnknownCircuit = 4,
    VkInvalidLength = 5,
    VkInvalidParameters = 6,
    ProofParseError = 7,
    VerificationFailed = 8,
    ReputationRootNotSet = 9,
}

#[contract]
pub struct ZkVerifierRegistry;

#[contractimpl]
impl ZkVerifierRegistry {
    /// Initialize the registry. Can only be called once.
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN_KEY) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN_KEY, &admin);
        Ok(())
    }

    /// Register a verification key for a circuit. Admin only.
    /// circuit_id: Symbol like "poseidon_v1" or "rep_v1"
    /// vk: raw VK bytes from `bb write_vk`
    pub fn register_circuit(env: Env, circuit_id: Symbol, vk: Bytes) -> Result<(), Error> {
        Self::require_admin(&env)?;

        // Validate VK bytes parse correctly before storing
        UltraHonkVerifier::new(&env, &vk).map_err(|e| match e {
            VkLoadError::WrongLength => Error::VkInvalidLength,
            VkLoadError::InvalidParameters => Error::VkInvalidParameters,
        })?;

        let mut map: Map<Symbol, Bytes> = env
            .storage()
            .instance()
            .get(&VK_MAP_KEY)
            .unwrap_or_else(|| Map::new(&env));

        map.set(circuit_id, vk);
        env.storage().instance().set(&VK_MAP_KEY, &map);
        Ok(())
    }

    /// Set the on-chain reputation Merkle root. Admin only.
    pub fn set_reputation_root(env: Env, root: Bytes) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&ROOT_KEY, &root);
        Ok(())
    }

    /// Get the current reputation Merkle root.
    pub fn get_reputation_root(env: Env) -> Result<Bytes, Error> {
        env.storage()
            .instance()
            .get(&ROOT_KEY)
            .ok_or(Error::ReputationRootNotSet)
    }

    /// Verify an UltraHonk proof for the given circuit.
    ///
    /// circuit_id:   Symbol matching a registered VK
    /// public_inputs: raw public input bytes (field elements, 32 bytes each, big-endian)
    /// proof:         raw UltraHonk proof bytes (PROOF_BYTES = 456 * 32 = 14592)
    ///
    /// Returns Ok(()) if valid, Err(VerificationFailed) otherwise.
    pub fn verify(
        env: Env,
        circuit_id: Symbol,
        public_inputs: Bytes,
        proof: Bytes,
    ) -> Result<(), Error> {
        let vk = Self::get_vk(&env, &circuit_id)?;
        let verifier = UltraHonkVerifier::new(&env, &vk).map_err(|e| match e {
            VkLoadError::WrongLength => Error::VkInvalidLength,
            VkLoadError::InvalidParameters => Error::VkInvalidParameters,
        })?;
        verifier
            .verify(&env, &proof, &public_inputs)
            .map_err(|_| Error::VerificationFailed)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    fn get_vk(env: &Env, circuit_id: &Symbol) -> Result<Bytes, Error> {
        let map: Map<Symbol, Bytes> = env
            .storage()
            .instance()
            .get(&VK_MAP_KEY)
            .ok_or(Error::UnknownCircuit)?;
        map.get(circuit_id.clone()).ok_or(Error::UnknownCircuit)
    }
}

#[cfg(test)]
mod test;
