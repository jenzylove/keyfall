//! Spike S1 for Q-DAY.
//!
//! Question 1: can a contract tell that the transaction signer used an
//! ML-DSA-65 (post-quantum) key? The runtime hands every function call the
//! borsh-encoded signer public key. Its first byte is the key type tag:
//! 0 = ed25519, 1 = secp256k1, 2 = ML-DSA-65.
//!
//! Question 2: can a contract create a player account that is born with only
//! an ML-DSA-65 full-access key?
//!
//! Raw host functions are used on purpose so the result does not depend on
//! whether a given near-sdk version knows the ML-DSA-65 key type.

use near_sdk::json_types::Base64VecU8;
use near_sdk::{env, near, AccountId, NearToken};

const ML_DSA_65_TAG: u8 = 2;
const ML_DSA_65_PUBKEY_LEN: usize = 1952;
const REGISTER: u64 = 0;

#[near(serializers = [json])]
pub struct SignerInfo {
    pub signer: AccountId,
    pub predecessor: AccountId,
    /// First byte of the borsh-encoded signer public key.
    pub key_tag: u8,
    /// Total length of the borsh-encoded signer public key in bytes.
    pub key_len: u64,
    /// Human name for the tag.
    pub key_type: String,
    /// True only for ML-DSA-65.
    pub quantum_safe: bool,
}

#[near(contract_state)]
#[derive(Default)]
pub struct Spike {
    calls: u64,
}

fn signer_pk_bytes() -> Vec<u8> {
    unsafe {
        near_sys::signer_account_pk(REGISTER);
        let len = near_sys::register_len(REGISTER);
        let mut buf = vec![0u8; len as usize];
        near_sys::read_register(REGISTER, buf.as_mut_ptr() as u64);
        buf
    }
}

fn type_name(tag: u8) -> &'static str {
    match tag {
        0 => "ed25519",
        1 => "secp256k1",
        2 => "ml-dsa-65",
        _ => "unknown",
    }
}

#[near]
impl Spike {
    /// Change method (the signer key is not available in view calls).
    /// Returns what the contract can see about who signed this transaction.
    pub fn whoami(&mut self) -> SignerInfo {
        self.calls += 1;
        let pk = signer_pk_bytes();
        let tag = pk.first().copied().unwrap_or(255);
        let info = SignerInfo {
            signer: env::signer_account_id(),
            predecessor: env::predecessor_account_id(),
            key_tag: tag,
            key_len: pk.len() as u64,
            key_type: type_name(tag).to_string(),
            quantum_safe: tag == ML_DSA_65_TAG,
        };
        env::log_str(&format!(
            "whoami signer={} tag={} type={} len={}",
            info.signer, info.key_tag, info.key_type, info.key_len
        ));
        info
    }

    /// Succeeds only when the transaction was signed with an ML-DSA-65 key.
    pub fn require_quantum(&mut self) -> bool {
        let pk = signer_pk_bytes();
        let tag = pk.first().copied().unwrap_or(255);
        if tag != ML_DSA_65_TAG {
            env::panic_str(&format!(
                "E_NOT_QUANTUM: signed with {} (tag {}), an ML-DSA-65 key is required",
                type_name(tag),
                tag
            ));
        }
        self.calls += 1;
        true
    }

    /// Creates `<name>.<this contract>` with exactly one access key: the given
    /// ML-DSA-65 public key (raw 1,952 bytes, base64), as a full-access key.
    /// The attached deposit funds the new account.
    #[payable]
    pub fn make_player(&mut self, name: String, pq_public_key: Base64VecU8) -> AccountId {
        let raw: Vec<u8> = pq_public_key.into();
        if raw.len() != ML_DSA_65_PUBKEY_LEN {
            env::panic_str(&format!(
                "E_BAD_KEY: expected {} raw ML-DSA-65 public key bytes, got {}",
                ML_DSA_65_PUBKEY_LEN,
                raw.len()
            ));
        }
        let deposit = env::attached_deposit();
        if deposit < NearToken::from_millinear(10) {
            env::panic_str("E_DEPOSIT: attach at least 0.01 NEAR to fund the player account");
        }
        let account: AccountId = format!("{}.{}", name, env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("E_BAD_NAME"));

        // Borsh PublicKey::MLDSA65 = tag 2 followed by the raw key bytes.
        let mut borsh_pk = Vec::with_capacity(1 + raw.len());
        borsh_pk.push(ML_DSA_65_TAG);
        borsh_pk.extend_from_slice(&raw);

        let account_bytes = account.as_str().as_bytes();
        let amount: u128 = deposit.as_yoctonear();
        unsafe {
            let p = near_sys::promise_batch_create(
                account_bytes.len() as u64,
                account_bytes.as_ptr() as u64,
            );
            near_sys::promise_batch_action_create_account(p);
            near_sys::promise_batch_action_transfer(p, &amount as *const u128 as u64);
            near_sys::promise_batch_action_add_key_with_full_access(
                p,
                borsh_pk.len() as u64,
                borsh_pk.as_ptr() as u64,
                0,
            );
            near_sys::promise_return(p);
        }
        account
    }

    pub fn calls(&self) -> u64 {
        self.calls
    }
}
