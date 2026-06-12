#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Env};

fn make_env() -> Env {
    Env::default()
}

fn deploy_and_init(env: &Env) -> (ZkVerifierRegistryClient, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(ZkVerifierRegistry, ());
    let client = ZkVerifierRegistryClient::new(env, &contract_id);
    env.mock_all_auths();
    client.init(&admin).expect("init should succeed");
    (client, admin)
}

#[test]
fn test_init_sets_admin() {
    let env = make_env();
    let (client, admin) = deploy_and_init(&env);
    // Second init must return AlreadyInitialized
    let result = client.try_init(&admin);
    assert!(result.is_err(), "double init should return error");
}

#[test]
fn test_register_requires_auth() {
    let env = make_env();
    let (client, _) = deploy_and_init(&env);
    // Without mocked auth a second time, register must fail
    env.mock_auths(&[]);
    let circuit_id = Symbol::new(&env, "poseidon_v1");
    let vk = Bytes::from_slice(&env, &[0xabu8; 1764]);
    let result = client.try_register_circuit(&circuit_id, &vk);
    assert!(result.is_err(), "register without auth should fail");
}

#[test]
fn test_reputation_root_roundtrip() {
    let env = make_env();
    let (client, _) = deploy_and_init(&env);
    env.mock_all_auths();

    let root = Bytes::from_slice(&env, &[0xffu8; 32]);
    client.set_reputation_root(&root).expect("set should succeed");

    let got = client.get_reputation_root().expect("get should succeed");
    assert_eq!(got, root);
}

#[test]
fn test_verify_unknown_circuit_returns_error() {
    let env = make_env();
    let (client, _) = deploy_and_init(&env);

    let bad_id = Symbol::new(&env, "no_such");
    let proof = Bytes::from_slice(&env, &[0u8; 14592]);
    let inputs = Bytes::from_slice(&env, &[0u8; 32]);

    let result = client.try_verify(&bad_id, &inputs, &proof);
    assert!(result.is_err(), "unknown circuit_id should return error");
}
