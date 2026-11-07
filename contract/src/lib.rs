//! Q-DAY: a memecoin you play.
//!
//! NEP-141 token + NEP-145 storage + the game. Every rule lives in
//! `qday-core`, shared with the simulation; this contract adds accounts,
//! money, the quantum-signer check and events.
//!
//! Vault moves (raid, defend, shield, boss, transfers and sells out of a
//! vault) must be signed directly by the vault with an ML-DSA-65 key. The
//! runtime passes the borsh-encoded signer public key to every call; its
//! first byte is the key type (2 = ML-DSA-65).

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, PromiseOrValue};
use qday_core::{
    quote_buy as core_quote_buy, quote_sell as core_quote_sell, spot_price, Error, Game, Holder, Kind, Params, Raid, State, Store, DECIMALS,
};
use serde_json::json;

const ML_DSA_65_TAG: u8 = 2;
const ML_DSA_65_PUBKEY_LEN: usize = 1952;
/// NEP-145 registration cost for one holder record.
const STORAGE_COST: NearToken = NearToken::from_micronear(2_500);
/// Smallest deposit to create a vault (funds its gas; ML-DSA-65 transactions
/// are large).
const VAULT_MIN_DEPOSIT: NearToken = NearToken::from_millinear(200);
const FEED_SIZE: u64 = 64;
const GAS_FOR_VAULT_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_FOR_RESOLVE_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_FOR_FT_ON_TRANSFER: Gas = Gas::from_tgas(35);

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct FeedItem {
    pub n: U64,
    pub at: U64,
    pub kind: String,
    pub actor: String,
    pub target: Option<String>,
    pub amount: U128,
    pub extra: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct SeasonResult {
    pub finalized_at: U64,
    pub frozen_exposed: U128,
    pub satoshi_frozen: U128,
    pub vault_total: U128,
    pub vaults: U64,
    pub burned: U128,
    pub top_vaults: Vec<(AccountId, U128)>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    params: Params,
    state: State,
    holders: LookupMap<String, Holder>,
    raids: LookupMap<u64, Raid>,
    vault_list: near_sdk::store::Vector<AccountId>,
    /// Every registered holder, exposed or vault, in order of arrival.
    holder_list: near_sdk::store::Vector<AccountId>,
    feed: LookupMap<u64, FeedItem>,
    feed_count: u64,
    season: Option<SeasonResult>,
}

/// Adapter so the core rules can read and write chain storage.
struct ChainStore<'a> {
    holders: &'a mut LookupMap<String, Holder>,
    raids: &'a mut LookupMap<u64, Raid>,
}

impl<'a> Store for ChainStore<'a> {
    fn holder(&self, id: &str) -> Option<Holder> {
        self.holders.get(id).cloned()
    }
    fn put_holder(&mut self, id: &str, h: Holder) {
        self.holders.insert(id.to_string(), h);
    }
    fn raid(&self, id: u64) -> Option<Raid> {
        self.raids.get(&id).cloned()
    }
    fn put_raid(&mut self, r: Raid) {
        self.raids.insert(r.id, r);
    }
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn fail(e: Error) -> ! {
    env::panic_str(e.code())
}

/// Key type of the transaction signer: 0 ed25519, 1 secp256k1, 2 ML-DSA-65.
#[cfg(not(test))]
fn signer_key_tag() -> u8 {
    unsafe {
        near_sys::signer_account_pk(0);
        let len = near_sys::register_len(0);
        let mut buf = vec![0u8; len as usize];
        near_sys::read_register(0, buf.as_mut_ptr() as u64);
        buf.first().copied().unwrap_or(255)
    }
}

#[cfg(test)]
thread_local! {
    pub static TEST_SIGNER_TAG: std::cell::Cell<u8> = const { std::cell::Cell::new(2) };
}
#[cfg(test)]
fn signer_key_tag() -> u8 {
    TEST_SIGNER_TAG.with(|t| t.get())
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "qday", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

fn emit_ft(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "nep141", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[near(serializers = [json])]
pub struct Stats {
    pub now_ms: U64,
    pub epoch: U64,
    pub epoch_ends_ms: U64,
    pub q_day_ms: U64,
    pub after_q_day: bool,
    pub harvest_due: bool,
    pub harvested: U64,
    pub exposed_tokens: U128,
    pub vault_tokens: U128,
    pub satoshi_tokens: U128,
    pub market_tokens: U128,
    pub escrow: U128,
    pub burned: U128,
    pub circulating: U128,
    pub near_reserve: U128,
    pub price_yocto_per_token: U128,
    pub vaults: U64,
    pub exposed_holders: U64,
    pub raids: U64,
    pub vault_share_bps: u32,
}

#[near(serializers = [json])]
pub struct HolderView {
    pub account: AccountId,
    pub kind: Kind,
    pub balance: U128,
    pub shield_bps: u32,
    pub immune_until: U64,
    pub under_raid: Option<U64>,
    pub raids_left: u32,
    pub boss_ready: bool,
}

#[near]
impl Contract {
    /// Initialise once. Deployed together with the removal of every access
    /// key, so the rules can never change.
    #[init]
    pub fn new(params: Params, start_ms: Option<U64>) -> Self {
        if let Err(e) = params.validate() {
            env::panic_str(e);
        }
        let start = start_ms.map(|s| s.0).unwrap_or_else(now_ms);
        let state = State::genesis(&params, start);
        emit(
            "genesis",
            json!({ "total_supply": U128(params.total_supply), "satoshi": U128(params.satoshi_supply), "start_ms": U64(start) }),
        );
        Self {
            params,
            state,
            holders: LookupMap::new(b"h"),
            raids: LookupMap::new(b"r"),
            vault_list: near_sdk::store::Vector::new(b"v"),
            holder_list: near_sdk::store::Vector::new(b"l"),
            feed: LookupMap::new(b"f"),
            feed_count: 0,
            season: None,
        }
    }

    // ------------------------------------------------------------ helpers

    fn game_parts(&mut self) -> (&Params, &mut State, ChainStore<'_>) {
        (
            &self.params,
            &mut self.state,
            ChainStore { holders: &mut self.holders, raids: &mut self.raids },
        )
    }

    fn push_feed(&mut self, kind: &str, actor: &str, target: Option<&str>, amount: u128, extra: Option<String>) {
        let n = self.feed_count;
        let item = FeedItem {
            n: U64(n),
            at: U64(now_ms()),
            kind: kind.to_string(),
            actor: actor.to_string(),
            target: target.map(|t| t.to_string()),
            amount: U128(amount),
            extra,
        };
        self.feed.insert(n % FEED_SIZE, item);
        self.feed_count += 1;
    }

    fn kind_of(&self, id: &AccountId) -> Option<Kind> {
        self.holders.get(id.as_str()).map(|h| h.kind)
    }

    /// The caller must be a registered vault, signing its own transaction
    /// with an ML-DSA-65 key.
    fn require_vault_quantum(&self) -> AccountId {
        let me = env::predecessor_account_id();
        if self.kind_of(&me) != Some(Kind::Vault) {
            fail(Error::NotVault);
        }
        Self::require_quantum_direct(&me);
        me
    }

    fn require_quantum_direct(me: &AccountId) {
        if &env::signer_account_id() != me {
            env::panic_str("E_RELAYED: vault moves must be signed by the vault itself, not relayed");
        }
        let tag = signer_key_tag();
        if tag != ML_DSA_65_TAG {
            env::panic_str(&format!(
                "E_NOT_QUANTUM: signed with key type {tag}; vault moves need an ML-DSA-65 signature"
            ));
        }
    }

    /// Any move of tokens out of a vault needs a quantum signature.
    fn guard_outflow(&self, from: &AccountId) {
        if self.kind_of(from) == Some(Kind::Vault) {
            Self::require_quantum_direct(from);
        }
    }

    fn register_exposed(&mut self, id: &AccountId) {
        let (p, s, mut st) = self.game_parts();
        Game::new(p, s, &mut st).register(id.as_str(), Kind::Exposed).unwrap_or_else(|e| fail(e));
        self.holder_list.push(id.clone());
    }

    fn view_holder(&self, id: &AccountId, h: &Holder) -> HolderView {
        let now = now_ms();
        let epoch = self.state.epoch(&self.params, now);
        HolderView {
            account: id.clone(),
            kind: h.kind,
            balance: U128(self.state.balance(h.kind, h.shares)),
            shield_bps: if h.kind == Kind::Vault && h.shield_epoch == epoch { h.shield_bps } else { 0 },
            immune_until: U64(h.immune_until),
            under_raid: h.under_raid.map(U64),
            raids_left: if h.kind != Kind::Vault {
                0
            } else if h.raid_epoch == epoch {
                self.params.max_raids_per_epoch.saturating_sub(h.raids_in_epoch)
            } else {
                self.params.max_raids_per_epoch
            },
            boss_ready: h.kind == Kind::Vault && h.last_boss_epoch != epoch && !self.state.after_q_day(&self.params, now),
        }
    }

    // ------------------------------------------------------------ vaults

    /// Create `<name>.<this contract>`, born with exactly one access key: the
    /// given ML-DSA-65 public key (raw 1,952 bytes, base64), full access.
    #[payable]
    pub fn create_vault(&mut self, name: String, pq_public_key: Base64VecU8) -> AccountId {
        let raw: Vec<u8> = pq_public_key.into();
        require!(raw.len() == ML_DSA_65_PUBKEY_LEN, "E_BAD_KEY: expected a raw 1952-byte ML-DSA-65 public key");
        let deposit = env::attached_deposit();
        require!(deposit >= VAULT_MIN_DEPOSIT, "E_DEPOSIT: attach at least 0.2 NEAR to fund your vault");
        require!(
            !name.is_empty() && name.len() <= 32 && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_'),
            "E_BAD_NAME: use lowercase letters, digits, - or _"
        );
        let vault: AccountId = format!("{}.{}", name, env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("E_BAD_NAME"));
        require!(self.kind_of(&vault).is_none(), "E_TAKEN: that vault name is taken");

        let mut borsh_pk = Vec::with_capacity(1 + raw.len());
        borsh_pk.push(ML_DSA_65_TAG);
        borsh_pk.extend_from_slice(&raw);

        let fund: u128 = deposit.as_yoctonear() - STORAGE_COST.as_yoctonear();
        let vault_bytes = vault.as_str().as_bytes();
        let me = env::current_account_id();
        let me_bytes = me.as_str().as_bytes();
        let cb_args = json!({ "vault": vault, "payer": env::predecessor_account_id(), "amount": U128(deposit.as_yoctonear()) })
            .to_string()
            .into_bytes();
        let method = b"on_vault_created";
        let zero: u128 = 0;
        unsafe {
            let p = near_sys::promise_batch_create(vault_bytes.len() as u64, vault_bytes.as_ptr() as u64);
            near_sys::promise_batch_action_create_account(p);
            near_sys::promise_batch_action_transfer(p, &fund as *const u128 as u64);
            near_sys::promise_batch_action_add_key_with_full_access(p, borsh_pk.len() as u64, borsh_pk.as_ptr() as u64, 0);
            let cb = near_sys::promise_then(
                p,
                me_bytes.len() as u64,
                me_bytes.as_ptr() as u64,
                method.len() as u64,
                method.as_ptr() as u64,
                cb_args.len() as u64,
                cb_args.as_ptr() as u64,
                &zero as *const u128 as u64,
                GAS_FOR_VAULT_CALLBACK.as_gas(),
            );
            near_sys::promise_return(cb);
        }
        vault
    }

    /// Registers the vault only if the account was really created.
    #[private]
    pub fn on_vault_created(&mut self, vault: AccountId, payer: AccountId, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 64).is_ok();
        if ok && self.kind_of(&vault).is_none() {
            let (p, s, mut st) = self.game_parts();
            Game::new(p, s, &mut st).register(vault.as_str(), Kind::Vault).unwrap_or_else(|e| fail(e));
            self.vault_list.push(vault.clone());
            self.holder_list.push(vault.clone());
            emit("vault_created", json!({ "vault": vault, "payer": payer }));
            self.push_feed("vault", vault.as_str(), None, 0, None);
            true
        } else {
            // Account creation failed: the transfer bounced back to us; refund.
            near_sdk::Promise::new(payer).transfer(NearToken::from_yoctonear(amount.0)).detach();
            false
        }
    }

    // ------------------------------------------------------------ market

    /// Buy with attached NEAR. Registers the buyer (0.0025 NEAR) if needed.
    #[payable]
    pub fn buy(&mut self, min_out: Option<U128>) -> U128 {
        let me = env::predecessor_account_id();
        let mut near_in = env::attached_deposit().as_yoctonear();
        match self.kind_of(&me) {
            None => {
                require!(near_in > STORAGE_COST.as_yoctonear(), "E_DEPOSIT: attach more than 0.0025 NEAR");
                near_in -= STORAGE_COST.as_yoctonear();
                self.register_exposed(&me);
            }
            Some(Kind::Vault) => Self::require_quantum_direct(&me),
            Some(Kind::Exposed) => {}
        }
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let o = Game::new(p, s, &mut st)
            .buy(me.as_str(), near_in, min_out.map(|m| m.0).unwrap_or(0), now)
            .unwrap_or_else(|e| fail(e));
        emit_ft("ft_mint", json!({ "owner_id": me, "amount": U128(o.tokens), "memo": "buy" }));
        emit("buy", json!({ "account": me, "near": U128(o.near), "tokens": U128(o.tokens) }));
        self.push_feed("buy", me.as_str(), None, o.tokens, Some(o.near.to_string()));
        U128(o.tokens)
    }

    /// Sell tokens back to the market for NEAR.
    pub fn sell(&mut self, amount: U128, min_near: Option<U128>) -> U128 {
        let me = env::predecessor_account_id();
        self.guard_outflow(&me);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let o = Game::new(p, s, &mut st)
            .sell(me.as_str(), amount.0, min_near.map(|m| m.0).unwrap_or(0), now)
            .unwrap_or_else(|e| fail(e));
        near_sdk::Promise::new(me.clone()).transfer(NearToken::from_yoctonear(o.near)).detach();
        emit_ft("ft_burn", json!({ "owner_id": me, "amount": U128(o.tokens), "memo": "sell" }));
        emit("sell", json!({ "account": me, "tokens": U128(o.tokens), "near": U128(o.near), "fee": U128(o.fee) }));
        self.push_feed("sell", me.as_str(), None, o.tokens, Some(o.near.to_string()));
        U128(o.near)
    }

    // ------------------------------------------------------------ game

    /// Permissionless: apply every harvest that is due.
    pub fn harvest(&mut self) -> U128 {
        let now = now_ms();
        let actor = env::predecessor_account_id();
        let (p, s, mut st) = self.game_parts();
        let o = Game::new(p, s, &mut st).harvest(now).unwrap_or_else(|e| fail(e));
        emit(
            "harvest",
            json!({ "epochs": U64(o.epochs), "taken": U128(o.taken), "burned": U128(o.burned), "to_vaults": U128(o.to_vaults) }),
        );
        self.push_feed("harvest", actor.as_str(), None, o.taken, Some(o.epochs.to_string()));
        U128(o.taken)
    }

    pub fn raid(&mut self, target: AccountId, stake: U128) -> U64 {
        let me = self.require_vault_quantum();
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let id = Game::new(p, s, &mut st).raid(me.as_str(), target.as_str(), stake.0, now).unwrap_or_else(|e| fail(e));
        let deadline = now + self.params.defend_window_ms;
        emit("raid_opened", json!({ "id": U64(id), "attacker": me, "target": target, "stake": U128(stake.0), "deadline_ms": U64(deadline) }));
        self.push_feed("raid", me.as_str(), Some(target.as_str()), stake.0, Some(id.to_string()));
        U64(id)
    }

    pub fn defend(&mut self, raid_id: U64) -> U128 {
        let me = self.require_vault_quantum();
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let r = Game::new(p, s, &mut st).defend(me.as_str(), raid_id.0, now).unwrap_or_else(|e| fail(e));
        let won = r.stake - r.burned;
        emit("defended", json!({ "id": raid_id, "attacker": r.attacker, "defender": me, "won": U128(won), "burned": U128(r.burned) }));
        self.push_feed("defend", me.as_str(), Some(r.attacker.as_str()), won, Some(raid_id.0.to_string()));
        U128(won)
    }

    /// Permissionless: settle a raid whose defend window has ended.
    pub fn resolve(&mut self, raid_id: U64) -> U128 {
        let now = now_ms();
        let actor = env::predecessor_account_id();
        let (p, s, mut st) = self.game_parts();
        let r = Game::new(p, s, &mut st).resolve(raid_id.0, now).unwrap_or_else(|e| fail(e));
        emit(
            "resolved",
            json!({ "id": raid_id, "attacker": r.attacker, "target": r.target, "take": U128(r.take), "burned": U128(r.burned), "by": actor }),
        );
        self.push_feed("resolve", r.attacker.as_str(), Some(r.target.as_str()), r.take, Some(raid_id.0.to_string()));
        U128(r.take)
    }

    pub fn charge_shield(&mut self, amount: U128) -> u32 {
        let me = self.require_vault_quantum();
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let strength = Game::new(p, s, &mut st).charge_shield(me.as_str(), amount.0, now).unwrap_or_else(|e| fail(e));
        emit_ft("ft_burn", json!({ "owner_id": me, "amount": amount, "memo": "shield" }));
        emit("shield", json!({ "vault": me, "burned": amount, "shield_bps": strength }));
        self.push_feed("shield", me.as_str(), None, amount.0, Some(strength.to_string()));
        strength
    }

    pub fn boss_raid(&mut self) -> U128 {
        let me = self.require_vault_quantum();
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let o = Game::new(p, s, &mut st).boss_raid(me.as_str(), now).unwrap_or_else(|e| fail(e));
        emit("boss_raid", json!({ "vault": me, "taken": U128(o.taken), "burned": U128(o.burned), "gained": U128(o.gained) }));
        self.push_feed("boss", me.as_str(), None, o.taken, None);
        U128(o.gained)
    }

    /// Permissionless, after Q-Day: write the season result on chain once.
    pub fn finalize(&mut self) -> SeasonResult {
        let now = now_ms();
        require!(self.state.after_q_day(&self.params, now), "E_SEASON_RUNNING: Q-Day has not arrived");
        require!(self.season.is_none(), "E_FINALIZED");
        let count = self.vault_list.len();
        let mut top: Vec<(AccountId, U128)> = vec![];
        for i in 0..count.min(2_000) {
            let v = self.vault_list[i].clone();
            if let Some(h) = self.holders.get(v.as_str()) {
                top.push((v, U128(self.state.balance(h.kind, h.shares))));
            }
        }
        top.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));
        top.truncate(10);
        let r = SeasonResult {
            finalized_at: U64(now),
            frozen_exposed: U128(self.state.e_tokens),
            satoshi_frozen: U128(self.state.satoshi_balance()),
            vault_total: U128(self.state.q_tokens),
            vaults: U64(self.state.vaults),
            burned: U128(self.state.burned),
            top_vaults: top,
        };
        emit("season_finalized", json!({ "frozen_exposed": r.frozen_exposed, "vault_total": r.vault_total, "vaults": r.vaults }));
        self.season = Some(r.clone());
        r
    }

    // ------------------------------------------------------------ views

    pub fn config(&self) -> &Params {
        &self.params
    }

    pub fn stats(&self) -> Stats {
        let now = now_ms();
        let p = &self.params;
        let s = &self.state;
        let epoch = s.epoch(p, now);
        let held = s.e_tokens + s.q_tokens;
        Stats {
            now_ms: U64(now),
            epoch: U64(epoch),
            epoch_ends_ms: U64(s.start_ms + (epoch + 1) * p.epoch_ms),
            q_day_ms: U64(s.q_day_ms(p)),
            after_q_day: s.after_q_day(p, now),
            harvest_due: s.harvested < epoch.min(p.season_epochs),
            harvested: U64(s.harvested),
            exposed_tokens: U128(s.e_tokens),
            vault_tokens: U128(s.q_tokens),
            satoshi_tokens: U128(s.satoshi_balance()),
            market_tokens: U128(s.curve_left(p)),
            escrow: U128(s.escrow),
            burned: U128(s.burned),
            circulating: U128(s.circulating(p)),
            near_reserve: U128(s.near_reserve),
            price_yocto_per_token: U128(spot_price(p, s)),
            vaults: U64(s.vaults),
            exposed_holders: U64(s.exposed_holders),
            raids: U64(s.next_raid_id - 1),
            vault_share_bps: if held == 0 { 0 } else { (s.q_tokens * 10_000 / held) as u32 },
        }
    }

    pub fn holder(&self, account_id: AccountId) -> Option<HolderView> {
        self.holders.get(account_id.as_str()).map(|h| self.view_holder(&account_id, h))
    }

    pub fn get_raid(&self, raid_id: U64) -> Option<Raid> {
        self.raids.get(&raid_id.0).cloned()
    }

    /// Latest moves, newest first.
    pub fn feed(&self, limit: Option<u64>) -> Vec<FeedItem> {
        let limit = limit.unwrap_or(30).min(FEED_SIZE);
        let mut out = vec![];
        let mut n = self.feed_count;
        while n > 0 && (out.len() as u64) < limit && self.feed_count - n < FEED_SIZE {
            n -= 1;
            if let Some(i) = self.feed.get(&(n % FEED_SIZE)) {
                out.push(i.clone());
            }
        }
        out
    }

    pub fn vaults(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<HolderView> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(200);
        (from..(from + limit).min(self.vault_list.len()))
            .filter_map(|i| {
                let v = self.vault_list[i].clone();
                self.holders.get(v.as_str()).map(|h| self.view_holder(&v, h))
            })
            .collect()
    }

    /// Every holder (exposed wallets and vaults), in order of arrival.
    pub fn holders(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<HolderView> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(200);
        (from..(from + limit).min(self.holder_list.len()))
            .filter_map(|i| {
                let v = self.holder_list[i].clone();
                self.holders.get(v.as_str()).map(|h| self.view_holder(&v, h))
            })
            .collect()
    }

    pub fn holder_count(&self) -> u32 {
        self.holder_list.len()
    }

    /// Open raids among the latest `scan` raids (default 100), newest first.
    pub fn open_raids(&self, scan: Option<u64>) -> Vec<Raid> {
        let last = self.state.next_raid_id.saturating_sub(1);
        let lo = last.saturating_sub(scan.unwrap_or(100).min(300));
        ((lo + 1)..=last)
            .rev()
            .filter_map(|id| self.raids.get(&id).cloned())
            .filter(|r| r.status == qday_core::RaidStatus::Open)
            .collect()
    }

    pub fn season(&self) -> Option<SeasonResult> {
        self.season.clone()
    }

    pub fn quote_buy(&self, near: U128) -> Option<U128> {
        core_quote_buy(&self.params, &self.state, near.0).map(U128)
    }

    pub fn quote_sell(&self, amount: U128) -> Option<U128> {
        let fee = qday_core::math::bps(amount.0, self.params.sell_fee_bps);
        core_quote_sell(&self.params, &self.state, amount.0 - fee).map(U128)
    }

    // ------------------------------------------------------------ NEP-141

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        near_sdk::assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);
        let on_transfer = near_sdk::Promise::new(receiver_id.clone()).function_call(
            "ft_on_transfer".to_string(),
            json!({ "sender_id": sender, "amount": amount, "msg": msg }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FOR_FT_ON_TRANSFER,
        );
        let resolve = near_sdk::Promise::new(env::current_account_id()).function_call(
            "ft_resolve_transfer".to_string(),
            json!({ "sender_id": sender, "receiver_id": receiver_id, "amount": amount }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FOR_RESOLVE_TRANSFER,
        );
        PromiseOrValue::Promise(on_transfer.then(resolve))
    }

    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result_checked(0, 128) {
            Ok(v) => serde_json::from_slice::<U128>(&v).map(|u| u.0.min(amount.0)).unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        let mut used = amount.0;
        if unused > 0 {
            let now = now_ms();
            let (p, s, mut st) = self.game_parts();
            let mut g = Game::new(p, s, &mut st);
            let refund = unused.min(g.balance_of(receiver_id.as_str()));
            if refund > 0 && g.transfer(receiver_id.as_str(), sender_id.as_str(), refund, now).is_ok() {
                emit_ft("ft_transfer", json!({ "old_owner_id": receiver_id, "new_owner_id": sender_id, "amount": U128(refund), "memo": "refund" }));
                used = amount.0 - refund;
            }
        }
        U128(used)
    }

    fn internal_transfer(&mut self, from: &AccountId, to: &AccountId, amount: u128, memo: Option<String>) {
        self.guard_outflow(from);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        Game::new(p, s, &mut st).transfer(from.as_str(), to.as_str(), amount, now).unwrap_or_else(|e| fail(e));
        emit_ft("ft_transfer", json!({ "old_owner_id": from, "new_owner_id": to, "amount": U128(amount), "memo": memo }));
        let migrated = self.kind_of(from) == Some(Kind::Exposed) && self.kind_of(to) == Some(Kind::Vault);
        self.push_feed(if migrated { "migrate" } else { "transfer" }, from.as_str(), Some(to.as_str()), amount, None);
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.state.circulating(&self.params))
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.holders.get(account_id.as_str()).map(|h| self.state.balance(h.kind, h.shares)).unwrap_or(0))
    }

    pub fn ft_metadata(&self) -> serde_json::Value {
        json!({
            "spec": "ft-1.0.0",
            "name": "Q-DAY",
            "symbol": "QDAY",
            "icon": ICON,
            "reference": null,
            "reference_hash": null,
            "decimals": DECIMALS,
        })
    }

    // ------------------------------------------------------------ NEP-145

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> serde_json::Value {
        let _ = registration_only;
        let id = account_id.unwrap_or_else(env::predecessor_account_id);
        let deposit = env::attached_deposit();
        if self.kind_of(&id).is_some() {
            if deposit.as_yoctonear() > 0 {
                near_sdk::Promise::new(env::predecessor_account_id()).transfer(deposit).detach();
            }
        } else {
            require!(deposit >= STORAGE_COST, "E_DEPOSIT: storage costs 0.0025 NEAR");
            self.register_exposed(&id);
            let refund = deposit.as_yoctonear() - STORAGE_COST.as_yoctonear();
            if refund > 0 {
                near_sdk::Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(refund)).detach();
            }
        }
        json!({ "total": U128(STORAGE_COST.as_yoctonear()), "available": "0" })
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<serde_json::Value> {
        self.kind_of(&account_id).map(|_| json!({ "total": U128(STORAGE_COST.as_yoctonear()), "available": "0" }))
    }

    pub fn storage_balance_bounds(&self) -> serde_json::Value {
        json!({ "min": U128(STORAGE_COST.as_yoctonear()), "max": U128(STORAGE_COST.as_yoctonear()) })
    }

    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> serde_json::Value {
        near_sdk::assert_one_yocto();
        require!(amount.map_or(true, |a| a.0 == 0), "E_NOTHING_TO_WITHDRAW");
        json!({ "total": U128(STORAGE_COST.as_yoctonear()), "available": "0" })
    }

    #[payable]
    pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        near_sdk::assert_one_yocto();
        let _ = force;
        false
    }
}

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230a0a0a'/%3E%3Ccircle cx='32' cy='32' r='17' fill='none' stroke='%23d4ff3a' stroke-width='6'/%3E%3Cpath d='M40 40l11 11' stroke='%23d4ff3a' stroke-width='6' stroke-linecap='round'/%3E%3C/svg%3E";

#[cfg(test)]
mod tests;
